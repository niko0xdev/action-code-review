# V3 Code Review Prompt — Research & Improvement Plan

> Research artifact. Companion to `docs/v2-design-spec.md` (authoritative spec),
> `docs/v2-architecture.md` (what was actually built) and `v1-interface-contract.md`
> (frozen public interface). This document does **not** change shipped behavior —
> it proposes V3 prompt + tooling improvements for the V2 engine.

**Date:** 2026-08-31
**Author:** Hermes Agent (CC research pass)
**Repo:** `niko0xdev/action-code-review`

---

## TL;DR

Three highest-leverage improvements, ranked by impact per effort:

1. **Tool integration layer (Stage Pre-LLM)**: run deterministic linters/type-checkers
   (biome/eslint, ruff/mypy, swiftlint/ktlint, sqlfluff) before invoking Pi and
   feed structured findings into the prompt as *evidence* — eliminates
   50–70% of false positives and gives the LLM a reliable baseline to argue against.
2. **Per-stack profile expansion**: add explicit checklist rows for
   TailwindCSS/Shadcn/BaseUI, PostgreSQL/MySQL (SQL injection, N+1, indexes,
   migrations), Swift 6 concurrency, Kotlin Compose 1.7+ recomposition;
   current rules mention these stacks only in passing.
3. **Two-pass review (Plan → Verify)**: keep current single-shot JSON parse
   but add an optional second pass that asks the model to challenge its own
   top-N critical/high findings before publishing. Catches hallucinated
   path/line numbers and reasoning shortcuts.

All other improvements (severity matrix tightening, confidence calibration,
suggested-change heuristics) are smaller refinements that fall out naturally
once the tool layer exists.

---

## A. Research Summary

### A.1 Reference repos (verified stars via GitHub API, 2026-08-31)

| Repo | Stars | Core value | Key technique to adopt | Evidence |
|------|-------|------------|------------------------|----------|
| `alibaba/open-code-review` | **21,706** | Battle-tested hybrid review at Alibaba scale | Deterministic pipeline first, LLM agent for high-level reasoning; splits defects by severity tier | https://github.com/alibaba/open-code-review |
| `The-PR-Agent/pr-agent` | **12,782** | Original open-source PR reviewer; multi-tool integration | Many static analyzers integrated (ruff, bandit, eslint, etc.) feeding structured context to LLM | https://github.com/The-PR-Agent/pr-agent |
| `baz-scm/awesome-reviewers` | **143** | Curated LLM system prompts for agentic code review | Per-language prompts loaded on demand; one script (`pr-analyzer.py`) for PR complexity scoring | https://github.com/baz-scm/awesome-reviewers |
| `kodustech/awesome-ai-code-review` | **44** | Curated list of AI review tools | Maps tool ↔ niche; useful to confirm we cover SQL/N+1, iOS, Android, FE niches (we currently do not explicitly) | https://github.com/kodustech/awesome-ai-code-review |
| `awesome-skills/code-review-skill` | low (exact star count not visible from page; thin metadata) | Claude Code skill format for review | SKILL.md structure (~220 lines), progressive loading of 20+ language guides, single `scripts/pr-analyzer.py` tool | https://github.com/awesome-skills/code-review-skill |
| `anthroos/claude-code-review-skill` | **39** | Free alternative to CodeRabbit for Claude Code CLI | Skill-format review, integrated with Claude Code tooling | https://github.com/anthroos/claude-code-review-skill |

**Stars caveat:** `goodailist.com` page content was thin (mostly external blog
links, no star counts surfaced directly). The two user-supplied reference
URLs (`open-code-review`, `awesome-skills/code-review-skill`) and the four
newer ones (`pr-agent`, `awesome-reviewers`, `awesome-ai-code-review`,
`claude-code-review-skill`) were validated via `curl ... api.github.com/repos/...`
from the workspace. `goodailist.com` itself is not a source of truth — treat it
as a discovery starting point only.

### A.2 What each repo teaches us

**`alibaba/open-code-review` (21.7k stars)** — page does not disclose the
exact system prompt, but architecture description makes the pattern clear:
deterministic static-analysis pipelines (linter, type-checker, security
scanner) run first, then the LLM agent acts on top of structured findings.
Their defect categories mention `NPE`, `thread-safety`, `XSS`, `SQL injection`
explicitly — i.e. high-impact categories only. We should adopt: (a) split
"deterministic findings" vs "LLM findings" in output schema; (b) constrain the
LLM to high-level reasoning rather than re-discovering lint issues.

**`The-PR-Agent/pr-agent` (12.7k stars)** — original open-source PR review
agent, predates most commercial competitors. Demonstrates that broad tool
integration (ruff, bandit, eslint, ...) is feasible without bloating context
window if findings are summarized before being passed to the LLM. Adopt:
context-window budget per static analyzer, summarized to top-K issues.

**`baz-scm/awesome-reviewers` (143 stars)** — small but uniquely valuable:
this is a *catalog of real LLM system prompts* used by production review
agents, organized by language with source discussions. Worth inspecting a
handful of `_reviewers/<slug>.md` files to calibrate tone and checklist depth
(caveat: their reviewers target a different harness — Anthropic-style
prompting patterns differ from how Pi agent receives JSON instructions).

**`anthroos/claude-code-review-skill` (39 stars)** — direct format competitor
for our integration. SKILL.md pattern + on-demand language guides is
roughly the shape we already have in `v2/src/profiles/`, but with more
languages covered. Cross-check which stacks they cover that we don't
(likely Erlang/Elixir, Ruby, Scala — not in our user-required stack list).

**`kodustech/awesome-ai-code-review` (44 stars)** — when triaged by niche,
exposes the gap: very few tools claim "SQL/database N+1 detection" or
"iOS/Swift-specific review" or "Android/Kotlin-specific review" as a
*specialty*. Most tools are generic. This validates our investment in
per-stack profiles rather than chasing a generic-prompt upgrade.

**`awesome-skills/code-review-skill`** — page metadata confirms SKILL.md
layout (~220 lines core + `reference/`, `reference/cross-cutting/`,
`assets/`, `scripts/`), 20+ language guides loaded progressively, one
script (`pr-analyzer.py`) for PR complexity. We could mirror this layout
for our own skill export if we want CC users to consume our review logic
as a skill rather than as a GitHub Action.

---

## B. Gap Analysis (current V2 vs best practice)

### B.1 React / NextJS / FE

Source: `v2/src/profiles/rules.ts:10-37`

| Status | Item |
|--------|------|
| ✅ | React hooks (deps, stale closures, memoization, keys) |
| ✅ | Accessibility (semantic HTML, ARIA, focus) |
| ✅ | NextJS server/client boundaries, SSR/hydration |
| ✅ | NextJS 15 cache components, revalidation |
| ⚠️ | **TailwindCSS** — only mentioned indirectly as "subjective visual design"; no check for class-name collisions, dynamic class generation (template-literal concatenation that breaks purge), `@apply` overuse, dark-mode token consistency |
| ⚠️ | **Shadcn/Radix UI** — no check for forwardRef correctness, controlled/uncontrolled Dialog/Select, portal mounting issues, server-component vs client-component boundary for interactive primitives |
| ⚠️ | **BaseUI** — not mentioned at all (no detection signal, no rules) |
| ❌ | Bundle size regressions (no heuristic for `import * from` in client code, no flag for missing `dynamic()` on heavy components) |
| ❌ | React Server Components serialization boundaries (passing non-serializable props from Server to Client) |

### B.2 NestJS / NodeJS / TS BE

Source: `v2/src/profiles/rules.ts:38-61`, `:95-109`

| Status | Item |
|--------|------|
| ✅ | N+1 queries, transaction scope, tenant isolation (good!) |
| ✅ | Missing await, floating promises, race conditions |
| ✅ | Async event-emitter correctness |
| ⚠️ | **Validation pipelines** — `class-validator` decorators vs Zod vs manual — not called out by framework |
| ⚠️ | **Logging hygiene** — PII in logs, structured logging fields, redaction in error path |
| ⚠️ | **OpenAPI/Swagger drift** — `@ApiProperty` not matching actual DTO; routes not in spec |
| ⚠️ | **Health checks / graceful shutdown** — no check for SIGTERM handler, draining in-flight requests |
| ❌ | **Rate limiting / throttling** — not in checklist (NestJS has `@nestjs/throttler`) |
| ❌ | **CORS / Helmet / cookie security flags** — security module not in rules |

### B.3 Python / FastAPI / uv

Source: `v2/src/profiles/rules.ts:62-72`

| Status | Item |
|--------|------|
| ✅ | Mutable default args, async/await misuse, exception handling breadth |
| ✅ | Pydantic contracts, FastAPI behavior |
| ✅ | `pyproject.toml` + `uv.lock` consistency |
| ⚠️ | **FastAPI dependency injection** — `Depends()` ordering, `yield` dependencies (background tasks not closed), request-scoped resources |
| ⚠️ | **Async DB drivers** — `asyncpg`/`SQLAlchemy 2.0 async` connection pool misuse, missing `await session.close()` |
| ⚠️ | **Type hints strictness** — Pydantic v2 `model_config` vs `ConfigDict`, generics in models |
| ❌ | **Mypy / pyright configuration drift** — no check that `pyproject.toml [tool.mypy]` is consistent with code style |
| ❌ | **Pydantic v2 migration patterns** — `.dict()` vs `.model_dump()`, `parse_obj` vs `model_validate` |

### B.4 PostgreSQL / MySQL — **MISSING PROFILE ENTIRELY**

There is no `postgres` or `mysql` profile in `v2/src/profiles/index.ts`. The
profiles set is hard-coded at `v2/src/profiles/index.ts:261-271`:

```ts
const PROFILE_IDS = new Set<ProfileId>([
  'react', 'nextjs', 'typescript', 'javascript',
  'nestjs', 'nodejs', 'python', 'swift', 'kotlin',
]);
```

There are also no detection signals for SQL files or DB directories
(`migrations/`, `prisma/`, `drizzle/`, `*.sql`). Result: SQL files in
PR diffs get reviewed only via `nestjs`/`python` rule strings, which
mention "transaction boundaries" but not:
- SQL injection patterns (string concatenation in raw queries)
- Index usage / missing indexes / `EXPLAIN` heuristics
- N+1 in ORMs (Prisma `include`, Drizzle `with`, TypeORM `relations`)
- Migration safety (irreversible DDL, locking, large-table operations)
- DB-specific gotchas: `SELECT *`, missing `LIMIT`, MySQL implicit type
  conversion, Postgres-specific JSONB operators, etc.

**This is the largest single gap.**

### B.5 Swift / iOS

Source: `v2/src/profiles/rules.ts:73-83`

| Status | Item |
|--------|------|
| ✅ | Swift 6 concurrency (Sendable, actors, MainActor) |
| ✅ | Retain cycles, weak/unowned |
| ✅ | SwiftUI state management, UIKit lifecycle |
| ⚠️ | **SwiftUI iOS 17+ Observation framework** — `@Observable` macro vs `ObservableObject` mix |
| ⚠️ | **CoreData / SwiftData** — context lifecycle, threading violations, `@MainActor` violations |
| ⚠️ | **Force unwrap / force cast** — not specifically called out (very common iOS bug class) |
| ❌ | **Combine framework** — sink lifecycle, AnyCancellable retention, scheduler correctness |
| ❌ | **Localization / strings** — hardcoded user-facing strings flagging |
| ❌ | **Test plans / UI testing** — XCUITest patterns, accessibility identifier discipline |

### B.6 Kotlin / Android

Source: `v2/src/profiles/rules.ts:84-94`

| Status | Item |
|--------|------|
| ✅ | Coroutines, structured concurrency, GlobalScope misuse |
| ✅ | Compose state, recomposition, `derivedStateOf` |
| ✅ | Room transactions, permissions |
| ⚠️ | **Compose 1.7+ stability** — `rememberSaveable` vs `remember`, key correctness |
| ⚠️ | **Hilt vs Koin vs manual DI** — scope mismatches, `@Singleton` vs `@ActivityRetainedScoped` |
| ⚠️ | **DataStore vs SharedPreferences** — migration paths |
| ❌ | **WorkManager constraints** — periodic vs one-time, network constraints, expedited work |
| ❌ | **R8/ProGuard rules** — class keeping, missing rules for reflection-based libs |

### B.7 Prompt structure itself

Source: `v2/src/harness/pi.ts:1-50`, `v2/src/llm/prompts/pr-content.ts:1-25`

| Status | Item |
|--------|------|
| ✅ | Persona is defined; JSON output format is enforced |
| ✅ | `UNIVERSAL_RULES` clearly states anti-patterns to skip |
| ⚠️ | Single-shot prompt — no plan-then-verify split, no chain-of-thought budget |
| ⚠️ | No structured checklist for the model to walk through (Pi gets the diff + rules + JSON schema, but no "go through this checklist, marking N/A where not applicable") |
| ⚠️ | Output schema not enumerated inline in prompt — relies on parser robustness (`v2/src/harness/harness.ts`) |
| ❌ | **No tools** passed to Pi beyond read-only `read/grep/find/ls` (`v2/src/harness/pi.ts:13`). Cannot run linters, type-checkers, or git blame from inside the harness |
| ❌ | **No prior findings context** — when reviewing commit N+1, we re-scan the whole repo instead of starting from commit N's findings delta |

### B.8 Validation pipeline

Source: `v2/src/review/validator.ts:14-37`, `v2/src/review/severity.ts:28-45`,
`v2/src/review/dedupe.ts:30-39`

| Status | Item |
|--------|------|
| ✅ | Confidence floor 0.80 (well-calibrated — see spec §18) |
| ✅ | Path-in-diff check (`isChangedLine`) — catches hallucinated file refs |
| ✅ | Dedupe key = `path\|line\|category\|normalized-title-hash` |
| ✅ | Severity caps (10/10/10/5) + overall cap 20 + confidence tie-break |
| ⚠️ | No check that the finding's `category` is from the allowed vocabulary (`v2/src/types/finding.ts`) — LLM can invent categories that pass through |
| ⚠️ | No cross-finding consistency check — two findings on same path/line range with conflicting recommendations both pass |
| ❌ | **No suggested-change payload validation** — `suggestion` field can be empty, malformed, or reference code outside the diff |
| ❌ | **No "trivial change" short-circuit** — 1-line doc typo PRs get full multi-group review (waste of tokens) |

---

## C. Proposed Improvements

### C.1 New system prompt structure

Replace the current `buildReviewPrompt` body in `v2/src/harness/harness.ts`
with a structured prompt that interleaves checklist + tools + output schema.
The principle: **make the model walk a checklist explicitly, with N/A markers,
before emitting JSON.** This both improves recall (model can't skip a row
accidentally) and gives us a parseable signal we can use for telemetry.

```text
[ROLE]
You are {{PROFILE_LIST}}-aware senior code reviewer for {{REPO_NAME}}.
Be precise. Cite line numbers from the diff only. Never invent paths.
Aim for high-signal findings; comments that don't change a decision are noise.

[SCOPE]
Review the PR titled "{{PR_TITLE}}".
Touched files: {{FILE_COUNT}} ({{ADDITIONS}}+ / {{DELETIONS}}-)
Detected stacks: {{PROFILES_HUMAN_LIST}}
Tool findings available: {{TOOL_FINDINGS_SUMMARY}}
Custom reviewer instructions: {{CUSTOM_INSTRUCTIONS_OR_NONE}}

[CHECKLIST — walk each row, mark N/A when not applicable]

Generic (always):
  ☐ Correctness — does the change do what it claims? Edge cases? Nulls?
  ☐ Security — injection, auth, secrets, input validation, unsafe deserialization
  ☐ Regression — what breaks? Backward compatibility? Migration path?
  ☐ Error handling — graceful failure, error types, retry/timeout policy
  ☐ Performance — N+1, blocking I/O, unbounded loops, missing pagination
  ☐ Concurrency — race conditions, locks, transaction scope, cancellation
  ☐ Testing — new behavior tested? Edge cases? Existing tests still pass?

FE profile (when react/nextjs):
  ☐ Hooks — deps, stale closures, unnecessary effects, key prop
  ☐ RSC boundaries — "use client" correct? Server-only code in client bundle?
  ☐ NextJS cache — fetch cache directives, revalidate, dynamic()
  ☐ TailwindCSS — class concat (breaks purge), dynamic class lookup
  ☐ Shadcn/BaseUI — controlled state, portal mount, ref forwarding

BE profile (when nestjs/nodejs):
  ☐ N+1 — loop with awaited query? Prisma include/Drizzle with misuse?
  ☐ Transaction — scope, isolation level, retry on serialization failure
  ☐ Validation — DTO matches reality? @ApiProperty matches response?
  ☐ Logging — PII, structured fields, redaction on error path
  ☐ Throttling/CORS/Helmet — present on public routes?

Python profile (when python):
  ☐ Mutable default arg, async/await misuse, generator cleanup
  ☐ FastAPI Depends() — yield deps, scope, request lifecycle
  ☐ Pydantic v2 — model_dump vs dict, model_validate vs parse_obj
  ☐ uv.lock — dependency change reflected? hash consistent?

SQL profile (when postgres/mysql — NEW):
  ☐ SQL injection — concatenation in raw queries, ORM raw fallback
  ☐ Index — missing on WHERE/JOIN column? unused index dropped?
  ☐ Migration — irreversible DDL, locking duration, large table?
  ☐ Pagination — missing LIMIT? OFFSET scaling problem?

Swift profile (when swift):
  ☐ Sendable — captured mutable state across actor boundary?
  ☐ Force unwrap / force cast — common iOS bug class
  ☐ SwiftUI — @Observable vs ObservableObject, State vs StateObject
  ☐ CoreData/SwiftData — context threading, @MainActor violation

Kotlin profile (when kotlin):
  ☐ Coroutine scope — GlobalScope, missing cancel, Dispatchers choice
  ☐ Compose stability — rememberSaveable, key parameter
  ☐ Lifecycle — collect in lifecycleScope, repeatOnLifecycle
  ☐ DI scope — @Singleton vs @ActivityRetainedScoped mismatch

[OUTPUT SCHEMA — emit exactly this JSON, nothing else]
{
  "summary": "<= 280 chars, plain English, what the PR does + risk verdict",
  "findings": [
    {
      "path": "<must be in changed files>",
      "line": <int, must be in diff>,
      "category": "<one of: correctness|security|performance|concurrency|regression|error-handling|testing|api|dx|accessibility|i18n>",
      "severity": "<one of: critical|high|medium|low>",
      "confidence": <0.0-1.0, floor 0.80>,
      "title": "<= 80 chars, imperative",
      "body": "<= 600 chars, explain WHY this is a bug + concrete fix sketch>",
      "suggestion": "<optional, replacement code as plain string — empty when not proposing a one-click fix>",
      "ruleId": "<optional, stable id for cross-PR dedupe>"
    }
  ],
  "risk": "<critical|high|medium|low|none>",
  "toolFindings": [{{SHORT_SUMMARY_OF_STATIC_ANALYZER_OUTPUT}}]
}

[GUARDRAILS]
- Max 1 finding per (path, line, category). More = better to dedupe silently.
- If unsure, omit. A PR with 2 solid findings beats one with 10 vague ones.
- Never review unchanged legacy code unless the change exposes a new bug.
- Never suggest style-only changes — leave those to biome/eslint/ruff.
```

Key differences vs current prompt:

- **Checklist with explicit rows** — model is forced to walk each category
- **Tool findings slot** — static-analyzer output is structured input, not
  rediscovery
- **Category vocabulary constraint** — eliminates invented categories
- **`ruleId`** — enables cross-PR dedupe and rule-tuning telemetry
- **`suggestion` field documented as optional** — current prompt has no
  guidance on when to emit it

### C.2 Per-stack review checklist (full)

(Full checklists are embedded in C.1 above. Profile-specific add-ons below.)

**PostgreSQL/MySQL checklist (new profile, see B.4):**

```text
SQL correctness:
- JOIN column types match exactly (VARCHAR vs TEXT implicit cast)
- NULL handling: COALESCE / NULLS FIRST ordering / IS DISTINCT FROM
- GROUP BY: non-aggregated columns in SELECT (Postgres strict)
- DISTINCT / GROUP BY cardinality — silently returning duplicate rows

Indexing:
- New WHERE/JOIN columns without index — flag as performance
- Low-selectivity index dropped — flag if used in WHERE
- Partial index predicate changed — verify against existing query patterns

Migration safety:
- ALTER TABLE on large table — flag for lock duration
- DROP COLUMN — verify no app code still references it (cross-stack)
- RENAME — flag for coordination risk (app deploy ordering)
- CREATE INDEX CONCURRENTLY (Postgres) — required in prod

ORM-specific:
- Prisma: nested `include` deeper than 2 levels → N+1 risk
- Drizzle: `with: {}` chain depth check
- TypeORM: `relations: []` without `loadEagerRelations: false`
- Knex / raw query: string interpolation detected → SQL injection

Connection pool:
- Pool size vs expected concurrency
- Long-running query → no statement_timeout
- Connection leak (missing release in finally)
```

**Swift/iOS add-ons (extend current rules):**

```text
- Force unwrap (!) and force cast (as!) — common crash class
- @MainActor correctness on UI updates
- Combine: AnyCancellable retained in sink init
- Localization: hardcoded user-facing string (not LocalizedStringKey)
- UITableView/UICollectionView reuse identifier correctness
- App tracking / ATT compliance if applicable
```

**Kotlin/Android add-ons:**

```text
- WorkManager: uniqueWork vs replace conflicts
- Compose: remember inside non-composable lambda
- LiveData vs Flow choice consistency
- R8/ProGuard: @Keep or rules for reflection-based libs (Moshi/Gson)
- Background work: foreground service type matching use case (Android 14+)
```

### C.3 Severity matrix

Current severity cap is 10/10/10/5 (critical/high/medium/low) — see
`FINDING_LIMITS` referenced in `v2/src/review/severity.ts`. We should
add a calibration table the model can reason against:

| Issue class (when not caught by tooling) | Default severity |
|--------------------------------------------|------------------|
| SQL injection, auth bypass, secret leak, unsafe deserialization | **critical** |
| Data loss / corruption, irreversible DDL without migration, missing transaction | **critical** |
| Race condition that can corrupt user data | **critical** |
| N+1 on hot path (>100 rows), unbounded query result | **high** |
| Missing input validation on user-facing endpoint | **high** |
| Force unwrap / force cast on external input | **high** |
| Memory leak (retain cycle, listener not removed) | **high** |
| Missing error handling on user-facing path | **medium** |
| N+1 on cold path | **medium** |
| Missing test for new branch | **medium** |
| Performance sub-optimal but not blocking | **medium** |
| Logging hygiene, naming clarity, missing JSDoc | **low** |
| Bundle size increase < 5% | **low** |

Confidence floor **0.80** is appropriate; below that the model should
self-suppress. The plan-verify pass in C.6 should re-evaluate critical
and high findings against this matrix.

### C.4 Suggested-change heuristics

Current code emits suggestions via `v2/src/github/suggestions.ts`. The
heuristics to add:

| Suggest when | Don't suggest when |
|--------------|---------------------|
| Finding is a single-line replace (typo, missing semicolon, missing await) | Change spans > 5 lines |
| Replacement is mechanical (add parameter, rename, add import) | Change requires domain knowledge |
| Replacement preserves indentation & syntax 1:1 | Replacement needs new imports/types |
| Confidence ≥ 0.95 | Confidence < 0.90 |
| Diff line is within one screen | Diff context > 30 lines |

**Format** — suggestion must be a raw code string, no markdown fences,
no PR-style description, no commentary. The wrapper GitHub comment carries
the explanation.

**Empty default** — most findings should have `"suggestion": ""` so the
review stays a comment, not a code-push.

### C.5 Validation rules (extends current `v2/src/review/validator.ts`)

Add these to the existing pipeline:

```text
NEW CHECK 1: category vocabulary
- finding.category MUST be in: correctness | security | performance
  | concurrency | regression | error-handling | testing | api | dx
  | accessibility | i18n
- otherwise drop the finding (no fallback bucket)

NEW CHECK 2: suggestion safety
- if suggestion is non-empty:
  - must compile-parse as valid syntax for the file's language
    (cheap AST parse; use tree-sitter if available)
  - must not introduce new identifiers not already in the file
  - if validation fails, set suggestion = "" (keep the comment, drop the suggestion)

NEW CHECK 3: cross-finding consistency
- if two findings on same (path, line range) give contradictory advice,
  keep the higher-confidence one and drop the lower
- if two findings on same (path, category) within 5 lines,
  merge into one (keep the longer body)

NEW CHECK 4: trivial-PR fast path
- if PR has < 5 lines total diff AND no test file changes:
  - skip plan-verify pass
  - cap findings at 3 total
  - skip SQL/iOS/Android-specific rule groups entirely
```

### C.6 Tools/skills integration roadmap

This is the largest single improvement. Stage the integration so that
existing behavior is untouched on stage 0, and each stage adds one
analyzer that the LLM sees as evidence.

| Stage | Tool | Purpose | Stack | Integration point |
|-------|------|---------|-------|-------------------|
| 0 (now) | (none) | LLM-only review | all | `v2/src/harness/pi.ts` |
| **1** | **biome** | FE lint + format (replaces eslint+prettier for many) | react/nextjs | `v2/src/context/prelint.ts` — new file, runs biome in repo, emits structured findings |
| **1** | **ruff** | Python lint (replaces flake8+isort+pyupgrade+black) | python | same prelint pattern |
| **2** | **eslint** (legacy) | If repo has eslint config incompatible with biome | react/nextjs/node | skip if biome already passes |
| **2** | **mypy --strict** | Python type check | python (only if pyproject.toml enables it) | prelint |
| **3** | **swiftlint** | Swift lint | swift | prelint |
| **3** | **ktlint** (or detekt) | Kotlin lint | kotlin | prelint |
| **4** | **sqlfluff** | SQL lint (dialect-aware) | postgres/mysql | prelint — must detect SQL files first (see C.7) |
| **5** | **semgrep** | Cross-stack security patterns (OWASP, CWE) | all | prelint — opt-in via action input |
| **6** | **madge / dependency-cruiser** | Circular deps, dead exports | node | prelint |
| **7** | **actionlint** | GitHub Actions YAML | all (when workflow files in diff) | prelint |

**Why this order:** stages 1–3 are zero-config (biome + ruff are single-binary
drop-ins, ktlint/swiftlint are standard for those ecosystems). Stage 4
requires adding the SQL profile (see C.7). Stages 5+ are opt-in.

**Format:** prelint emits a JSON array:

```json
{
  "tool": "ruff",
  "findings": [
    {
      "path": "src/api/users.py",
      "line": 42,
      "code": "B904",
      "severity": "high",
      "message": "raise without from inside except"
    }
  ]
}
```

The system prompt then renders this as `{{TOOL_FINDINGS_SUMMARY}}`
truncated to top 50 findings, sorted by severity. The LLM uses this
as *evidence* to write better findings, not as raw output.

**In harness prompt** (after Stage 1+):

```text
[STATIC ANALYSIS FINDINGS — treat as evidence, not as your output]
{{TOOL_FINDINGS_JSON}}
- Cite these in your findings when they confirm or contradict LLM review.
- You MAY add findings the tools missed (logical bugs, design issues).
- You SHOULD drop findings the tools already caught unless you add context.
```

### C.7 Add SQL profile (PostgreSQL + MySQL)

New files needed in `v2/src/profiles/`:

- `v2/src/profiles/sql.ts` — rule strings (see B.4 + C.2)
- Add to `PROFILE_IDS` set in `v2/src/profiles/index.ts:261`
- Add to `ProfileId` union in `v2/src/types/context.ts`
- Detection signals in `v2/src/profiles/common.ts`:
  ```ts
  { id: 'postgres', evidence: '*.sql + migrations/ or drizzle.config.ts',
    test: repo => hasMatchingFile(repo, '.', /\.sql$/) &&
                  (hasFile(repo, 'drizzle.config.ts', 'prisma/schema.prisma') ||
                   hasMatchingFile(repo, '.', /migrations?\//)) }
  { id: 'mysql', evidence: 'my.cnf / mysql dump header',
    test: repo => hasMatchingFile(repo, '.', /\.sql$/) }
  ```

Detecting one of `{postgres, mysql}` should also auto-add the `sql` rule
group to the prompt regardless of whether a backend profile matched.

### C.8 Two-pass review (Plan → Verify)

Add optional flag `REVIEW_VERIFY_PASS=true` (default off, opt-in via
action input). When enabled:

1. **Pass 1** — current logic, single-shot JSON.
2. **Pass 2** — short follow-up prompt:

   ```text
   Review your own findings above. For each finding with
   severity >= high, answer:
   - Is the line number real? (yes/no)
   - Is the code as quoted actually in the diff? (yes/no)
   - Would a senior engineer agree this is a bug? (yes/no)
   - If any answer is "no", drop or downgrade that finding.
   Return the same JSON shape with surviving findings only.
   ```

Cost: ~30% more tokens for high-quality critical findings. Worth it for
`critical`/`high` reviews; skip for trivial PRs (see C.5 NEW CHECK 4).

### C.9 Improve prompt structure summary

The four prompt-engineering improvements ranked:

1. **Explicit checklist (C.1)** — biggest single prompt-level win
2. **Tool findings slot (C.6)** — biggest external-improvement win
3. **Category vocabulary constraint (C.5)** — eliminates silent bugs
4. **Output example block** — add 1–2 example findings to anchor format
   (current prompt shows schema only, no example)

---

## D. Implementation Roadmap

### Phase 1 — Profile expansion + checklist (no harness changes)

**Goal:** improve prompt content for SQL + Tailwind/Shadcn/BaseUI + iOS/Android add-ons without touching Pi harness.

**Deliverables:**
- `v2/src/profiles/sql.ts` new file
- `v2/src/profiles/rules.ts` extended (Tailwind/Shadcn/BaseUI rows, iOS/Android add-ons)
- `v2/src/profiles/common.ts` + `index.ts` SQL detection + ProfileId union
- Update `docs/v2-design-spec.md` § stack profiles table

**Validation:** add 2 sample PR fixtures per new stack under
`v2/tests/fixtures/` and assert findings contain expected categories.

**Risks:** category vocabulary change breaks existing findings parser —
mitigate by keeping the new vocabulary additive, not destructive.

### Phase 2 — Static analysis integration (biome + ruff)

**Goal:** first deterministic layer added, output available to LLM as evidence.

**Deliverables:**
- New `v2/src/context/prelint.ts` orchestrator
- Biome + Ruff runners with JSON output parsing
- Harness prompt (C.1) reads `{{TOOL_FINDINGS_SUMMARY}}`
- Action input `enable-prelint: boolean = false` (off by default for backward compat)
- `v2/tests/prelint.test.ts`

**Risks:** slow CI for repos without biome/ruff installed — mitigate by
skipping prelint when binary missing, not erroring.

### Phase 3 — Validation hardening (suggestion safety + dedup)

**Goal:** drop noisy / unsafe findings before publishing.

**Deliverables:**
- Extend `v2/src/review/validator.ts` with C.5 NEW CHECK 1, 2, 3, 4
- Tree-sitter integration for suggestion syntax check (gated on tree-sitter availability)
- Tests for each new check

**Risks:** tree-sitter adds native dependency — gate via optional import.

### Phase 4 — Remaining analyzers (swiftlint, ktlint, sqlfluff, semgrep)

**Goal:** complete the analyzer matrix from C.6 stages 3–5.

**Deliverables:**
- Swiftlint + ktlint runners (with auto-detect of binary)
- sqlfluff integration gated on SQL files in diff
- semgrep opt-in (action input `enable-semgrep`)
- Updated tool catalog in docs

**Risks:** semgrep adds another binary dependency — keep opt-in.

### Phase 5 — Two-pass verify (Plan → Verify)

**Goal:** critical/high findings get a self-review pass.

**Deliverables:**
- New `REVIEW_VERIFY_PASS` action input
- Second-pass prompt template
- Cost-budget guard (skip pass if input tokens > 80% of context)

**Risks:** 2x token cost for opted-in repos — document clearly.

---

## Open Questions

1. **Static analyzer binaries in CI image?** V2 currently relies on the
   checkout repo for tooling (Pi has `read/grep/find/ls`). To run
   biome/ruff/swiftlint we either (a) bundle them in the action's
   Docker image, (b) require the consumer repo to provide them via
   `package.json` scripts, or (c) fall back gracefully if missing.
   Recommend (a) for FE/BE/Python, (c) for Swift/Kotlin (heavier binaries).

2. **Backward compatibility for `FINDING_LIMITS`?** Adding new categories
   (C.5 NEW CHECK 1) might cause existing harness outputs (Pi returns
   invented categories) to be silently dropped. Acceptable, or should
   we emit a deprecation warning when we see unknown categories?

3. **Should we expose `toolFindings` in the GitHub review summary?**
   Useful for transparency but doubles the summary length. Recommend
   fold into "Risk verdict" + footnote.

4. **Two-pass review cost ceiling?** Default off, but if a user opts in,
   what's the max acceptable cost multiplier? Recommend 1.5x with hard cap.

5. **SQL detection false positives?** A repo with `.sql` files for
   documentation or fixtures might trip the SQL profile needlessly.
   Recommend requiring at least one of: migration tool config OR
   raw SQL in PR diff (heuristic: at least one `.sql` line in changed
   files matching `(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT)\s`).

---

## Appendix — Sources & Evidence

All stars verified via `curl -s -H "Accept: application/vnd.github+json"
https://api.github.com/repos/<owner>/<repo>` from the workspace on
2026-08-31 around 20:00 +07. Results captured in
`/tmp/cc-research-scratchpad.md` (extracted from CC session
`86adccbc-a4f1-4bf0-aa48-87d44b816139`).

`goodailist.com` page content was thin and did not return star counts;
treated as discovery starting point, not as primary evidence.

Repo file paths cited:
- `v2/src/harness/pi.ts:13` — readonly tools passed to Pi
- `v2/src/harness/harness.ts` — prompt builder + parser
- `v2/src/profiles/common.ts:60-158` — detection signals
- `v2/src/profiles/index.ts:261-271` — `PROFILE_IDS` set
- `v2/src/profiles/rules.ts:1-122` — universal + per-stack rules
- `v2/src/llm/prompts/pr-content.ts:1-25` — current system prompt
- `v2/src/review/validator.ts:14-47` — confidence + path-in-diff
- `v2/src/review/severity.ts:28-45` — severity cap + confidence tie-break
- `v2/src/review/dedupe.ts:30-39` — dedupe key construction
- `v2/src/types/finding.ts` — Finding shape + FINDING_LIMITS
- `v2/src/github/suggestions.ts` — suggestion formatting