# Docs

Start here. Each doc states what it covers and who should read it.

| Doc | Covers | Read when |
|-----|--------|-----------|
| [architecture.md](architecture.md) | What was built: pipeline, layout, Pi provisioning, env vars | Running, extending, or debugging the engine |
| [design-spec.md](design-spec.md) | Full engine spec: profiles, validation, limits, prompts, rollout | Reviewing a change for spec compliance |
| [v1-interface-contract.md](v1-interface-contract.md) | Frozen public surface: inputs, outputs, defaults, behavior | Touching `pr-*/action.yml`, inputs, outputs, or env names |
| [security-model.md](security-model.md) | Threat model: injection, secrets, permissions, plane separation | Touching prompts, subprocess calls, or anything published to GitHub |
| [security-review.md](security-review.md) | Security engine: profiles, inputs/outputs, skills, workflow examples | Using `mode: security` or changing security behavior |

## Historical decisions (folded in, files removed)

Past planning docs (`audit-phase-2-spec`, `feat-rich-summary-decision-spec`,
`v3-decisions`, `v3-prompt-research`) were working notes, not live specs.
What shipped from them:

- **Pre-LLM static analysis** (`src/context/prelint.ts`, opt-in via
  `AI_REVIEW_ENABLE_PRELINT=true`): biome, ruff, swiftlint, ktlint,
  sqlfluff run first; findings feed the review prompt as evidence.
  Missing binary = skip, never error.
- **Unknown finding categories bucket to `low`** (`src/review/reviewer.ts`):
  keeps unexpected harness output visible under the `low` cap instead of
  dropping it silently.
- **Tool findings in summary** (`src/github/comments.ts`,
  `src/github/review.ts`): collapsible `<details>` section, collapsed by
  default; `buildJobSummary` renders the same for `$GITHUB_STEP_SUMMARY`.
- **Two-pass verify** (`src/review/verify.ts`, implemented but **not wired
  into the pipeline**): opt-in via `AI_REVIEW_VERIFY_PASS=true`, cost
  ceiling `AI_REVIEW_VERIFY_BUDGET_USD` (default 0.50 USD), skipped when
  zero high/critical findings.
- **SQL profile guard** (`src/profiles/common.ts`): `postgres`/`mysql` fire
  only on `.sql` sources *plus* ORM/migration config or matching
  dependency — static `.sql` files alone do not trigger.
- **Rich summary + hard 2-state decision** (`src/github/comments.ts`,
  `src/github/review.ts`): APPROVED / CHANGES REQUESTED banner, risk +
  model + files-reviewed block, severity table, top-5 findings; `low`-only
  or zero findings post `APPROVE` (gated on `block-on-issues` and write
  permission), any higher severity posts `REQUEST_CHANGES`.
- **Stack rules** (`src/profiles/rules.ts`, `src/profiles/sql.ts`):
  per-stack checklists incl. React 19, NextJS 15, NestJS/Fastify, Pydantic
  v2, Swift 6, Kotlin 2.0, ES2024, Tailwind/Shadcn, SQL injection/indexing/
  migration safety.
- **Suggestion safety** (`src/review/validation.ts`,
  `src/github/suggestions.ts`): replacements capped at 10 lines / 400 chars;
  oversized or unanchored replacements degrade to prose comments.
