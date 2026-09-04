# Changelog

All notable changes. Format follows Keep a Changelog; each entry maps
to a merged PR.


All notable V3 changes. V3 is a **prompt + tooling upgrade layer** on top
of the V2 engine; the V1 interface contract is unchanged.

The full research artifact that motivated V3 lives in
`docs/v3-prompt-research.md`. The decision record (resolving 5 Open
Questions) lives in `docs/v3-decisions.md`.

## [3.0.0] — 2026-08-31

### Added

- **SQL profiles (postgres + mysql)** (#49). Shared rule set covers
  SQL injection, indexing, migration safety (irreversible DDL,
  Postgres CONCURRENTLY), ORM-specific N+1 detection for Prisma /
  Drizzle / TypeORM / Knex, pool/timeout, MySQL-only gotchas
  (implicit type conversion, `ONLY_FULL_GROUP_BY`).
- **Stack rule extensions** (#49):
  - React/NextJS: TailwindCSS class concatenation, Shadcn/Radix
    state/ref forwarding, Server-Client serialization boundary,
    `dynamic()` for heavy client components, fetch cache directives.
  - Swift: force unwrap/cast, Combine `AnyCancellable` retention,
    hardcoded user-facing strings (i18n), `@Observable` vs
    `ObservableObject` consistency.
  - Kotlin: Compose `rememberSaveable`, WorkManager constraints,
    LiveData/Flow consistency, R8/ProGuard keep rules for reflection.
- **PreLint layer** (#52). Deterministic static-analyzer orchestrator
  with 5 default runners — `biome` (TS/JS), `ruff` (Python),
  `swiftlint` (iOS), `ktlint` (Kotlin), `sqlfluff` (SQL). Each runner
  probes `node_modules/.bin/<name>`; missing binaries gracefully skip
  (per ADR Q1) without failing the review. Tool findings become
  structured `ToolFinding` records injected into the LLM prompt as
  evidence, reducing redundant lint findings.
- **Validation hardening** (#64). Four new pipeline checks layered
  after existing validation: (1) category vocabulary bucket
  unknown categories to `severity: 'low'` rather than silently drop;
  (2) suggestion safety strips unbalanced/replacement fields;
  (3) cross-finding consistency drops contradictory advice in same
  `(path, category, line±5)`; (4) trivial-PR fast path caps to
  top-3 findings when `totalChanges < 5` and no test file changes.
- **Two-pass verify** (#66). Opt-in via `AI_REVIEW_VERIFY_PASS=true`
  with cost ceiling via `AI_REVIEW_VERIFY_BUDGET_USD` (default
  $0.50). After the main review pass, optionally runs a second short
  LLM call asking the model to challenge its own high/critical
  findings. Skipped automatically when zero high/critical findings
  or estimated cost exceeds budget.
- **PR summary renderer** (#67). Tool findings + pipeline diagnostics
  surface in collapsible `<details>` blocks at the bottom of the
  GitHub PR summary. Always markdown-escaped via existing `mdSafe()`
  helper to neutralize XSS via crafted tool output.

### Changed

- **`docs/v3-decisions.md`** — resolves the 5 Open Questions from
  `docs/v3-prompt-research.md`:
  - **Q1**: bundle biome + ruff; graceful skip for Swift/Kotlin/SQL.
  - **Q2**: bucket unknown categories to `low` severity (no silent
    drops; count surfaced in `ReviewDiagnostics`).
  - **Q3**: expose toolFindings + diagnostics in PR summary.
  - **Q4**: 1.5x cost multiplier + `$0.50` hard cap on two-pass verify.
  - **Q5**: SQL detection requires raw SQL keywords in PR diff.

### Opt-in environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_REVIEW_ENABLE_PRELINT` | `false` | Run biome + ruff + swiftlint + ktlint + sqlfluff before review |
| `AI_REVIEW_VERIFY_PASS` | `false` | Enable two-pass verify for high/critical findings |
| `AI_REVIEW_VERIFY_BUDGET_USD` | `0.5` | Hard cap on verify pass cost |

All new behavior is opt-in. Existing consumers see no change.

### Backward compatibility

- V1 interface contract (`docs/v1-interface-contract.md`) — **unchanged**:
  same `pr-review/action.yml` inputs, same outputs, same env vars
  consumed. Cannot add new inputs (V1 frozen), so all V3 features
  are gated by new env vars.
- V2 engine (`v2/`) — additive: new optional fields on `ReviewResult`
  (`toolFindings?`, `diagnostics?`), new optional `PiHarnessOptions`
  fields (`toolFindings?`), new optional `RunReviewOptions` fields
  (`verify?`, `inputTokenEstimate?`, `outputTokenBudget?`,
  `verifyBudgetUsd?`).

### Test coverage

- 320+ unit tests across the V2 engine (`pnpm test`)
- 32 dedicated Phase 3 tests for validation pipeline
- 14 dedicated Phase 5 tests for verify pass
- 6 dedicated Phase 6 tests for summary renderer

### PRs in this release

- #48 — Research artifact
- #49 — Phase 1: SQL profiles + FE/iOS/Android rule extensions
- #52 — Phase 2: PreLint layer (biome + ruff)
- #64 — Phase 3: Validation hardening
- #65 — Phase 4: swiftlint + ktlint + sqlfluff runners
- #66 — Phase 5: Two-pass verify (opt-in + cost ceiling)
- #67 — Phase 6: toolFindings + diagnostics in PR summary


All notable V2 changes. Format follows Keep a Changelog; each entry maps
to a merged PR.

## [2.0.0] — 2026-08-26

### Added
- **V2 engine package** (`v2/`) with TypeScript (NodeNext, strict),
  vitest and biome (#14).
- **Frozen V1 interface contract** (`docs/v1-interface-contract.md`) plus
  contract tests that parse both legacy `action.yml` files on every run
  so interface drift fails CI (#15).
- **OpenAI-compatible LLM layer** — config normalization from the frozen
  `OPENAI_API_*` variables, capability flags instead of model-name
  conditionals, chat-completions transport with timeout and secret
  redaction, JSON extraction for structured output (#16).
- **Pi harness wrapper** — `ReviewHarness` interface, review prompt with
  the spec §24 prompt-injection defense, Pi child process in read-only
  JSON mode with timeout and diagnostics (#17).
- **Context layer** — PR context assembly with pagination, unified-diff
  new-side line mapping, default ignore rules (lockfiles excluded,
  manifests kept), area grouping for large PRs (#18).
- **Review core** — planner, orchestration loop, §18 validation gates,
  duplicate suppression keeping strongest copy, §19 severity caps,
  risk computation, legacy-compatible `ai-review-id` hashing (#19).
- **Profiles** — deterministic detection for React/NextJS/NestJS/NodeJS/
  TypeScript/JavaScript/Python-uv/Swift/Kotlin-Android with evidence,
  stack rule sets per §10–15, `AI_REVIEW_PROFILE` override (#20).
- **GitHub publisher** — inline comments with severity badges and the
  frozen id marker, gated ```suggestion``` blocks, summary comment with
  risk + severity distribution, job-summary renderer, minimal publisher
  surface (#21).
- **Adapter layer** — legacy input mapping with exact V1 defaults, Pi
  runtime `models.json` in a temp `PI_CODING_AGENT_DIR`, engine-config
  resolution from inputs or env (#22, #24).
- **End-to-end pipeline test** exercising context → profiles → review →
  validation → publish payloads against a fixture repo (#23).
- **pr-review delegation bridge** — V2 takes over when present in the
  checkout; V1 otherwise unchanged (#25).
- **Documentation** — `docs/v2-architecture.md`, README updates, this
  changelog (#26).

### Deviations from the suggested feature order
- The compatibility adapters were split into three PRs (input mapping
  #22, orchestrator #24, delegation bridge #25) to keep every merge
  green and reviewable.
- E2E integration tests (#23) landed before the final adapter wiring so
  the pipeline was proven before touching action entry points.
- `pr-content` still runs its V1 runtime; its engine options are mapped
  and tested but the switchover is documented as follow-up work.

### Fixed / notes
- 5 pre-existing test failures in `pr-review` (dependencyResolver,
  importParser, prompts) exist on main predating all V2 work and are
  intentionally untouched.
