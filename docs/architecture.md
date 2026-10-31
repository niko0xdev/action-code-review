# Architecture

> Companion to `docs/design-spec.md` (the authoritative spec) and
> `docs/v1-interface-contract.md` (the frozen public interface). This
> document describes what was actually built, how the pieces fit, and how
> to run/extend the engine.

## Guiding principle

> Replace the engine, not the interface.

Consumer repositories keep using:

```yaml
uses: niko0xdev/action-code-review/pr-review@<ref>
uses: niko0xdev/action-code-review/pr-content@<ref>
```

with `github-token` / `openai-api-key` / `openai-base-url` /
`openai-model` inputs and the `OPENAI_API_*` environment variables.
Internally everything below those surfaces changed.

## Layout

```text
action-code-review/
├── pr-content/          # thin action (action.yml + dist, public surface frozen)
├── pr-review/           # thin action (action.yml + dist, public surface frozen)
├── src/                 # the engine
│   ├── cli.ts                 # main(): event/actor gates, then dispatch to a runner
│   ├── runners/               # review.ts (PR review + include/exclude filters),
│   │                          # pr-content.ts, security.ts, octokit.ts (shared adapter)
│   ├── adapter/               # legacy-inputs, engine-config, runtime
│   ├── context/               # pr, diff, files, repository, prelint
│   ├── harness/               # ReviewHarness interface + Pi wrapper
│   ├── llm/                   # provider, config, openai-compatible
│   ├── review/                # planner, reviewer, validator,
│   │                          # severity caps, dedupe, verify pass
│   ├── profiles/              # stack detection + rule sets
│   ├── security/              # scanners, skill router, validators, SARIF
│   ├── github/                # review publisher, comments, suggestions
│   └── types/                 # context + finding models
├── tests/               # unit + contract + e2e (vitest)
├── skills/              # stack review skills (source SKILL.md files)
└── docs/                  # index.md + specs (see docs/index.md)
```

## Review pipeline

```text
GitHub PR event
  ↓
pr-review action (composite: harness setup + dist/index.js)
  ↓  dist entry (src/entry/pr-review.ts, ncc-built)
engine CLI (src/cli.ts dispatches to src/runners/review.ts)
  ├─ mapPrReviewInputs      — frozen inputs → engine options
  ├─ resolveEngineConfig    — inputs or OPENAI_API_* env fallback
  ├─ fetchPrContext         — PR metadata + paginated file list
  ├─ legacy exclude/include filters + change-volume prioritization
  ├─ detectProfiles         — react/nextjs/nestjs/nodejs/ts/js/python/swift/kotlin
  ├─ preparePiRuntimeConfig — models.json and settings.json (compaction off) in a temp PI_CODING_AGENT_DIR
  ↓
Pi coding agent (child process, read-only tools: read,grep,find,ls)
  ↓  OpenAI-compatible gateway (chat/completions)
candidate findings (strict JSON)
  ↓
validateFindings   — path in PR? line touched? confidence ≥ 0.80?
dedupeFindings     — strongest copy per path+line+category+title
capFindings        — 10/10/10/5 per severity, 20 overall
  ↓
publishReview      — one createReview (REQUEST_CHANGES or COMMENT)
                    + PR summary comment (+ job summary content)
```

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| Pi runs as a child process with `--tools read,grep,find,ls`, `--no-session`, JSON mode | Spec §23 security model: repository inspector, not an executor; nothing writes to the repo; no session state leaks between runs |
| Runtime `models.json` via `PI_CODING_AGENT_DIR` | The host `~/.pi` never enters the review path; config dies with the runner |
| Capability flags (`supportsDeveloperRole`, `maxTokensField`) instead of model checks | Spec §30 model independence; gateways vary centrally, app code stays neutral |
| Strip reasoning artifacts at transport boundary | Compatible gateways may expose `reasoning_content` or inline `<think>` tags; remove them before JSON parsing or PR publication |
| Findings anchored to new-side diff lines via unified-diff mapping | GitHub inline comments require exact post-change line numbers; validator drops anything unanchorable |
| Legacy `<!-- ai-review-id:<12hex> -->` marker preserved | Duplicate suppression keeps working across legacy/engine threads |
| Self-contained dists per action | `src/entry/pr-review.ts` + `pr-content.ts` ncc-built direct to `pr-*/dist/index.js`; no shared `dist/`, no per-action packages |
| Contract tests parse both `action.yml` files on every run | Any interface drift fails CI immediately |

## Pi runtime provisioning

The actions ship as **composite actions**: `actions/setup-node` (pinned to a
full commit SHA, v4.4.0) provisions Node.js 24. `pr-review` then runs a bash
pre-step that installs the Pi coding agent; `pr-content` never spawns Pi (it
calls the OpenAI-compatible provider directly), so it has no install step.
Consumer repositories never install or reference either runtime themselves.

```yaml
- name: Setup Node.js
  uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
  with:
    node-version: '24'
- name: Setup harness loop
  shell: bash
  run: |
    if ! command -v pi >/dev/null 2>&1; then
      npm ci --prefix "$GITHUB_ACTION_PATH/pi-runtime" --ignore-scripts --no-audit --no-fund --silent
      echo "$GITHUB_ACTION_PATH/pi-runtime/node_modules/.bin" >> "$GITHUB_PATH"
    fi
```

Node.js 24 matches `actions/checkout@v5`'s runtime and exceeds this
engine's ES2022 target. Both action files provision it before harness setup;
`pr-review` still skips only harness installation when `pi-binary-path` is set.

Properties:
- **Idempotent guard** — `command -v pi` short-circuits the npm install
  when the binary already exists (self-hosted runners with warm caches
  save ~30s per job).
- **Pinned Node runtime** — setup-node pins major version 24 so npm always
  exists on runners where no Node runtime is preinstalled.
- **Reproducible install** — `pr-review/pi-runtime/` holds a `package.json`
  and committed `package-lock.json`; `npm ci --ignore-scripts` installs the
  full transitive tree with integrity hashes, so nothing floats. The version
  `0.73.1` is mirrored in `src/adapter/pi-install.ts` (`PI_PACKAGE_PIN`) and
  asserted against the manifest and lockfile by
  `tests/runtime-install.test.ts`. To bump, edit `package.json`, run
  `npm install --package-lock-only --ignore-scripts` in that directory, and
  update `PI_PACKAGE_PIN`.
- **Clean logs** — `--no-audit --no-fund --silent`.
- **Zero public-interface change** — every input/output in both
  action.yml files stays byte-identical; the composite step forwards all
  inputs to `dist/index.js` via `INPUT_*` environment variables, matching
  how GitHub Actions exposes them to node20 actions.

If the harness still cannot find the binary at review time (network
failure during install), the error message points at the composite step
logs rather than telling consumers to install Pi manually.

## Inline comment replies

Findings post as line-anchored inline comments (`side: RIGHT`) ending in
the `<!-- ai-review-id:<12hex> -->` marker. The engine can also **reply to an
existing review thread** — useful for follow-up explanations after a
reviewer asks for clarification:

```ts
// src/github/review.ts
await replyToReviewComment(octokit, {
  owner, repo, prNumber,
  commentId: 123456,          // GitHub's numeric review comment id
  body: 'Follow-up explanation…',
  finding,                    // optional; re-appends the ai-review-id marker
});
```

Properties:
- Reply-only: the function never posts a summary or a new review.
- The reply body re-appends the same `ai-review-id` marker as the
  original inline comment so duplicate suppression stays thread-consistent.
- Activation is env-gated and off by default: set
  `INPUT_REPLY_TO_COMMENT_ID` + `INPUT_REPLY_BODY` (V1 path) or call the
  publisher API directly. These are **internal** variables — they
  are not part of the frozen public action inputs.

## Security posture

- The review process only ever reads the repository. It cannot execute
  PR-controlled scripts, install dependencies, or run tests (spec §23).
- API keys flow from GitHub secrets into the runtime config dir only;
  error paths redact `sk-*` material before logging (spec §37).
- Prompt-injection defense is restated verbatim in every review prompt:
  repository content is untrusted data, never instructions (spec §24).

## Test coverage floor

`pnpm test:coverage` enforces the thresholds in `vitest.config.ts` (lines and
statements 87, functions 83, branches 82), set just below the totals measured
when `src/cli.ts` was split into `src/runners/`. Raise them as coverage grows;
never lower them to make a change pass. CI runs `pnpm test:coverage`, so a
pull request that drops below the floor fails. `tests/cli-main.test.ts` pins the
observable behaviour of each `main()` flow.

## Running

```bash
pnpm install
pnpm test          # full suite
pnpm typecheck
pnpm lint          # biome
pnpm build         # pinned ncc (devDependency) → pr-*/dist/index.js; CI diffs the result
```

## Scorecard context (opt-in)

Input `scorecard-context` (default `'false'`; see `src/context/scorecard.ts`). When
`'true'` and the repository is public, one unauthenticated GET is made to
`https://api.securityscorecards.dev/projects/github.com/{owner}/{repo}` (5 s timeout,
256 KiB cap, no secrets sent). The response is untrusted third-party data: only the
overall score (clamped 0 to 10) and the scores (clamped -1 to 10) of a fixed list of
checks (`Branch-Protection`, `Pinned-Dependencies`, `Token-Permissions`, `SAST`,
`Dangerous-Workflow`, `Vulnerabilities`, `Code-Review`, `Dependency-Update-Tool`,
`Security-Policy`, `Binary-Artifacts`) are kept. No reason strings, URLs, or other text
reach the prompt; the table is rendered from a fixed template next to the static analyser
evidence, never in the trusted rules slot, with an instruction that the scores are
advisory context and not findings. Any failure (404, timeout, bad JSON, oversize, private
repository) logs one `[scorecard]` line and the review continues without it.

**Privacy:** when enabled, the owner and repository name are sent to
`api.securityscorecards.dev`, a third-party service.

## Optional configuration (spec §8)

Numeric variables are validated by `src/shared/numeric.ts`: an invalid value logs a warning and falls back to the default, so it can never disable a limit.

| Variable | Default | Meaning |
|----------|---------|---------|
| `AI_REVIEW_MAX_FILES` | `100` | hard ceiling above the input `max-files`; must be a positive integer |
| `AI_REVIEW_MIN_CONFIDENCE` | `0.80` | validation confidence floor (0 to 1) |
| `AI_REVIEW_PROFILE` | detected | comma-separated profile override; `auto` = detect, `all` = load every stack's rules |
| `AI_REVIEW_ENABLE_PRELINT` | `false` | run biome/ruff/swiftlint/ktlint/sqlfluff first (`'true'` to enable) |
| `AI_REVIEW_SKIP_DRAFTS` | `false` | skip draft PRs (`'true'` to enable); `ready_for_review` still triggers a full review |
| `AI_REVIEW_INCLUDE_LOCKFILES` | `false` | review lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, and others) instead of skipping them (`'true'` to enable); other default ignore rules still apply |
| `AI_REVIEW_PI_TIMEOUT_MS` | `900000` | Pi process timeout |
| `AI_REVIEW_PI_MAX_OUTPUT_BYTES` | `67108864` | last-resort merged stdout+stderr ceiling per harness process (`0` disables). Pi runs in text mode (final message only), so this only fires on a truly stuck process |
| `AI_REVIEW_PI_MAX_TOOL_CALLS` | `60` | tool-execution ceiling; a runaway tool loop is stopped with an attributable error (`0` disables) |
| `AI_REVIEW_PI_MAX_ASSISTANT_BYTES` | `524288` | streamed assistant-text ceiling; a provider that loops instead of answering is stopped with an attributable error (`0` disables) |
| `AI_REVIEW_PI_REPAIR_ATTEMPTS` | `1` | extra harness calls that ask the model to convert its own unparseable answer into the required JSON |
| `AI_REVIEW_LLM_TIMEOUT_MS` | `600000` | OpenAI-compatible per-attempt request timeout; 408, 429, 5xx, and connection resets get up to 3 attempts with backoff and `Retry-After` (never retried: request timeouts, other 4xx, unparseable 200 bodies) |
| `AI_REVIEW_VERIFY_PASS` | `false` | second LLM pass over high/critical findings (`'true'` to enable; drops hallucinations, records stats in diagnostics) |
| `AI_REVIEW_VERIFY_BUDGET_USD` | `0.50` | cost ceiling for the verify pass (0 or more); estimated before the call, never exceeded |
| `AI_REVIEW_VERIFY_MIN_SEVERITY` | `high` | lowest severity the verify pass challenges (`critical`, `high`, `medium`, `low`); lower floors cost more |
| `AI_REVIEW_DEBUG_HARNESS` | unset | `true`/`1` or a byte budget: append redacted, truncated raw harness output to the step summary |
| `AI_REVIEW_FAIL_ON_INCOMPLETE` | `true` | fail the step when the review is incomplete (crashed group, unanalyzed files, truncated changed-file list); `false` downgrades to a warning |

All optional; consumers providing none still work unchanged.

## Patterns aligned with CCA

Adopted from [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) (read-only clone `/tmp/claude-code-action`; Pi remains the harness — no Claude SDK import). Sources use `main` at audit time (2026-08-31).

| # | CCA pattern | CCA source | Engine file:line |
|---|-------------|------------|--------------|
| 1 | Mode auto-detection (`detectMode`) | `src/modes/detector.ts:14`, `src/entrypoints/prepare.ts:30-34` | `src/modes/detector.ts:1-`, `src/cli.ts:26,289-298`, `pr-review/action.yml:57-60` |
| 2 | Write-permission gating (`checkWritePermissions`) | `src/entrypoints/prepare.ts:40-54`, `src/github/validation/permissions.ts:56-130` | `src/github/permissions.ts:1-`, `src/github/review.ts:64-122`, `src/cli.ts:430-460` |
| 3 | Buffered inline comments + Haiku classification | `src/entrypoints/post-buffered-inline-comments.ts:1-235` | `src/github/buffer.ts` (append and heuristic classify only), `src/github/review.ts:138-160`, `src/cli.ts` buffer flag |
| 4 | `allowed_bots` / actor allowlist (`include/exclude_comments_by_actor`) | `action.yml:30-54`, `src/github/validation/permissions.ts:9-30` | `src/github/actor-filter.ts:1-`, `src/cli.ts:315-330`, `pr-review/action.yml:73-80` |
| 5 | `use_sticky_comment` (single summary) | `action.yml:112-115` | `src/github/comments.ts:stickySummaryMarker`, `src/github/review.ts:196-320`, `pr-review/action.yml:81-84` |
| 6 | `track_progress` via `$GITHUB_STEP_SUMMARY` | `action.yml:136-139`, `src/modes/detector.ts:16-31` | `src/github/progress.ts:1-`, `src/cli.ts` phase hooks, `pr-review/action.yml:85-88` |
| 7 | `prompt` as raw + template file | `action.yml:57-59` | `pr-review/action.yml:89-92`, `src/cli.ts:readPromptFileIfNeeded` |
| 8 | `claude_args` / `pi_args` passthrough (whitelisted) | `action.yml:104-107`, `src/create-prompt/index.ts:14-70` | `src/harness/pi.ts:parsePiArgs/buildPiArgs`, `src/cli.ts`, `pr-review/action.yml:93-96` |
| 10 | `path_to_claude_code_executable` → `pi-binary-path` | `action.yml:144-148` | `pr-review/action.yml:93-96`, `src/cli.ts:454-465` |

Deferred/Rejected: **#9** OIDC/non-standard auth header (provider-agnostic already; defer) · **#11** `include_fix_links` (defer) · **#12** `trigger_phrase` for issue-comments (REJECT, review-only) · **#13** dup of #8 (REJECT) · **#14** Bedrock/Vertex/Foundry providers (REJECT, OpenAI-compatible) · **#15** `track_progress` for issues (REJECT, PR-only) · **#16** ephemeral GitHub App (REJECT, composite action). Deferred at audit time; tracked in git history, not in a live doc.

## Known limitations / next steps

1. **~~Pi binary provisioning~~ — DONE.** Both actions are now composite
   actions that install a pinned Pi release idempotently at runtime (see
   "Pi runtime provisioning" above).
2. **`pr-content` engine path** — `src/entry/pr-content.ts` delegates to the
   same `main()` as pr-review with `['pr-content']`; both dists are ncc-built
   from `src/entry/`.
3. **Evaluation dataset** (spec §34) — fixtures exist for detection
   tests (`tests/profiles/`, `tests/e2e/pipeline.test.ts`); LLM-judged
   finding-quality evals remain future work.
4. **~~Verify pass wiring~~ — DONE.** `src/review/verify.ts` runs in the
   pipeline behind `AI_REVIEW_VERIFY_PASS=true` (default off); kept/dropped
   counts surface in the diagnostics block. Candidates carry ids (`c1`..`cN`) and the model
   returns one `verified` verdict per id; verdicts match by id only. A failed,
   unusable, or partial reply keeps every finding, marks the review incomplete,
   and records the reason in the summary, so a verify outage fails the step by
   default while findings are still published (`AI_REVIEW_FAIL_ON_INCOMPLETE=false`
   downgrades it to a warning). The output ceiling scales with the candidate
   count.
5. **Review decision on re-runs** — `REQUEST_CHANGES` is decided from every
   valid finding, including ones already commented, and is submitted separately
   from the inline comments so it survives the per-comment fallback. When
   nothing new needs posting and the action's latest review is already
   `CHANGES_REQUESTED` on the same head commit (author matched by exact login,
   or, when the login is unresolved, `github-actions[bot]` with the event-only
   body text), the body-only event is not
   submitted again (one timeline entry per head, not per run); a new head, a
   dismissed, `COMMENTED`, or approved earlier review, or any new inline
   comment still submits. An empty file selection is a notice, except when an
   `include-dir` or a non-default `exclude-patterns` removed every file, which
   warns. `include-dir` strips a leading `/` and ignores entries with `..`.
6. **Harness reliability** — a malformed harness answer is retried once with a
   conversion prompt (`AI_REVIEW_PI_REPAIR_ATTEMPTS`), a runaway tool loop is
   stopped by `AI_REVIEW_PI_MAX_TOOL_CALLS`, and the output budget is now 8 MiB
   instead of 50 MiB so a group fails in seconds with an attributable message.
   A group that still fails marks the run incomplete and fails the step, and
   `AI_REVIEW_DEBUG_HARNESS=true` dumps the raw harness output to the step
   summary for diagnosis.
