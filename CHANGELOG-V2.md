# Changelog — V2

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
