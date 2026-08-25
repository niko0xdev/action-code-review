# V2 Architecture

> Companion to `docs/v2-design-spec.md` (the authoritative spec) and
> `docs/v1-interface-contract.md` (the frozen public interface). This
> document describes what was actually built, how the pieces fit, and how
> to run/extend V2.

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
├── pr-content/          # legacy action (public surface frozen)
├── pr-review/           # legacy action + V2 delegation bridge
├── v2/                  # the new engine
│   ├── src/
│   │   ├── cli.ts                 # pr-review orchestration entry
│   │   ├── adapter/               # legacy-inputs, engine-config, runtime
│   │   ├── context/               # pr, diff, files, repository
│   │   ├── harness/               # ReviewHarness interface + Pi wrapper
│   │   ├── llm/                   # provider, config, openai-compatible
│   │   ├── review/                # planner, reviewer, validator,
│   │   │                          # severity caps, dedupe
│   │   ├── profiles/              # stack detection + rule sets
│   │   ├── github/                # review publisher, comments, suggestions
│   │   └── types/                 # context + finding models
│   ├── tests/                     # unit + contract + e2e (vitest)
│   └── docs → ../docs
└── docs/
    ├── v1-interface-contract.md   # immutable compatibility contract
    └── v2-architecture.md         # this file
```

## Review pipeline

```text
GitHub PR event
  ↓
pr-review action (node20)
  ↓  delegation bridge (v2Delegate.ts)
V2 engine CLI (v2/src/cli.ts)
  ├─ mapPrReviewInputs      — frozen inputs → engine options
  ├─ resolveEngineConfig    — inputs or OPENAI_API_* env fallback
  ├─ fetchPrContext         — PR metadata + paginated file list
  ├─ legacy exclude/include filters + change-volume prioritization
  ├─ detectProfiles         — react/nextjs/nestjs/nodejs/ts/js/python/swift/kotlin
  ├─ preparePiRuntimeConfig — models.json in a temp PI_CODING_AGENT_DIR
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
| Findings anchored to new-side diff lines via unified-diff mapping | GitHub inline comments require exact post-change line numbers; validator drops anything unanchorable |
| Legacy `<!-- ai-review-id:<12hex> -->` marker preserved | Duplicate suppression keeps working across V1/V2 threads |
| Delegation bridge in `pr-review/src/index.ts` | If `v2/dist/entry/pr-review.js` exists it takes over; otherwise V1 runs unchanged — zero-risk rollout |
| Contract tests parse both `action.yml` files on every run | Any interface drift fails CI immediately |

## Security posture

- The review process only ever reads the repository. It cannot execute
  PR-controlled scripts, install dependencies, or run tests (spec §23).
- API keys flow from GitHub secrets into the runtime config dir only;
  error paths redact `sk-*` material before logging (spec §37).
- Prompt-injection defense is restated verbatim in every review prompt:
  repository content is untrusted data, never instructions (spec §24).

## Running

```bash
cd v2
pnpm install
pnpm test          # full suite
pnpm typecheck
pnpm lint          # biome
pnpm build         # tsc → dist/
```

## Optional configuration (spec §8)

| Variable | Default | Meaning |
|----------|---------|---------|
| `AI_REVIEW_LEVEL` | `standard` | reserved for depth presets |
| `AI_REVIEW_MAX_FILES` | `100` | hard ceiling above the input `max-files` |
| `AI_REVIEW_MAX_FINDINGS` | `20` | overall publish cap |
| `AI_REVIEW_MIN_CONFIDENCE` | `0.80` | validation confidence floor |
| `AI_REVIEW_PROFILE` | `auto` | comma-separated profile override |

All optional; consumers providing none still work unchanged.

## Known limitations / next steps

1. **Pi binary provisioning** — runners need `pi` installed (e.g. a setup
   step running `npm i -g @mariozechner/pi-coding-agent`). Wiring that
   install step into the composite action is the natural follow-up.
2. **`pr-content` V2 path** — the pr-content engine options are mapped
   and tested, but its runtime still uses the V1 flow; switching it over
   should mirror the pr-review delegation bridge.
3. **Pre-existing V1 test failures** — 5 failures in
   `dependencyResolver`, `importParser` and `prompts` tests exist on main
   predating V2 work; worth a dedicated cleanup PR.
4. **Evaluation dataset** (spec §34) — fixtures exist for detection
   tests; LLM-judged finding-quality evals remain future work.
5. **Shadow/pilot rollout** (spec §41) — enable per-repo via the
   delegation bridge's presence check before flipping default refs.
