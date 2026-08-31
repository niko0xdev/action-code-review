# Changelog — V3

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
