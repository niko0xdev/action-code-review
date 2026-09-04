# Architecture

> Companion to `docs/v2-design-spec.md` (the authoritative spec) and
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
├── tests/               # unit + contract + e2e (vitest)
└── docs/
└── docs/
    ├── v1-interface-contract.md   # immutable compatibility contract
    └── architecture.md            # this file
```

## Review pipeline

```text
GitHub PR event
  ↓
pr-review action (composite: harness setup + dist/index.js)
  ↓  dist entry (src/entry/pr-review.ts, ncc-built)
engine CLI (src/cli.ts)
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
| Legacy `<!-- ai-review-id:<12hex> -->` marker preserved | Duplicate suppression keeps working across legacy/engine threads |
| Self-contained dists per action | `src/entry/pr-review.ts` + `pr-content.ts` ncc-built direct to `pr-*/dist/index.js`; no shared `dist/`, no per-action packages |
| Contract tests parse both `action.yml` files on every run | Any interface drift fails CI immediately |

## Pi runtime provisioning

The actions ship as **composite actions**: a bash pre-step installs the
Pi coding agent into the runner before the node entry executes, so
consumer repositories never install or reference Pi themselves.

```yaml
- name: Setup harness loop
  shell: bash
  run: |
    if ! command -v pi >/dev/null 2>&1; then
      npm install -g @mariozechner/pi-coding-agent@0.73.1 --no-audit --no-fund --silent
    fi
```

Properties:
- **Idempotent guard** — `command -v pi` short-circuits the npm install
  when the binary already exists (self-hosted runners with warm caches
  save ~30s per job).
- **Pinned version** — `0.73.1` is embedded in both action.yml files and
  mirrored in `src/adapter/pi-install.ts` (`PI_PACKAGE_PIN`, asserted
  by `tests/runtime-install.test.ts`). Bump both together.
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

## Running

```bash
pnpm install
pnpm test          # full suite
pnpm typecheck
pnpm lint          # biome
pnpm build         # ncc → pr-*/dist/index.js
```

## Optional configuration (spec §8)

| Variable | Default | Meaning |
|----------|---------|---------|
| `AI_REVIEW_LEVEL` | `standard` | reserved for depth presets |
| `AI_REVIEW_MAX_FILES` | `100` | hard ceiling above the input `max-files` |
| `AI_REVIEW_MAX_FINDINGS` | `20` | overall publish cap |
| `AI_REVIEW_MIN_CONFIDENCE` | `0.80` | validation confidence floor |
| `AI_REVIEW_PROFILE` | `auto` | comma-separated profile override |
| `AI_REVIEW_PI_TIMEOUT_MS` | `900000` | Pi process timeout |
| `AI_REVIEW_LLM_TIMEOUT_MS` | `600000` | OpenAI-compatible request timeout |

All optional; consumers providing none still work unchanged.

## Patterns aligned with CCA

Adopted from [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) (read-only clone `/tmp/claude-code-action`; Pi remains the harness — no Claude SDK import). Sources use `main` at audit time (2026-08-31).

| # | CCA pattern | CCA source | Engine file:line |
|---|-------------|------------|--------------|
| 1 | Mode auto-detection (`detectMode`) | `src/modes/detector.ts:14`, `src/entrypoints/prepare.ts:30-34` | `src/modes/detector.ts:1-`, `src/cli.ts:26,289-298`, `pr-review/action.yml:57-60` |
| 2 | Write-permission gating (`checkWritePermissions`) | `src/entrypoints/prepare.ts:40-54`, `src/github/validation/permissions.ts:56-130` | `src/github/permissions.ts:1-`, `src/github/review.ts:64-122`, `src/cli.ts:430-460` |
| 3 | Buffered inline comments + Haiku classification | `src/entrypoints/post-buffered-inline-comments.ts:1-235` | `src/github/buffer.ts:1-`, `src/github/review.ts:138-160`, `src/cli.ts` buffer flag |
| 4 | `allowed_bots` / actor allowlist (`include/exclude_comments_by_actor`) | `action.yml:30-54`, `src/github/validation/permissions.ts:9-30` | `src/github/actor-filter.ts:1-`, `src/cli.ts:315-330`, `pr-review/action.yml:73-80` |
| 5 | `use_sticky_comment` (single summary) | `action.yml:112-115` | `src/github/comments.ts:stickySummaryMarker`, `src/github/review.ts:196-320`, `pr-review/action.yml:81-84` |
| 6 | `track_progress` via `$GITHUB_STEP_SUMMARY` | `action.yml:136-139`, `src/modes/detector.ts:16-31` | `src/github/progress.ts:1-`, `src/cli.ts` phase hooks, `pr-review/action.yml:85-88` |
| 7 | `prompt` as raw + template file | `action.yml:57-59` | `pr-review/action.yml:89-92`, `src/cli.ts:readPromptFileIfNeeded` |
| 8 | `claude_args` / `pi_args` passthrough (whitelisted) | `action.yml:104-107`, `src/create-prompt/index.ts:14-70` | `src/harness/pi.ts:parsePiArgs/buildPiArgs`, `src/cli.ts`, `pr-review/action.yml:93-96` |
| 10 | `path_to_claude_code_executable` → `pi-binary-path` | `action.yml:144-148` | `pr-review/action.yml:93-96`, `src/cli.ts:454-465` |

Deferred/Rejected: **#9** OIDC/non-standard auth header (provider-agnostic already; defer) · **#11** `include_fix_links` (defer) · **#12** `trigger_phrase` for issue-comments (REJECT, review-only) · **#13** dup of #8 (REJECT) · **#14** Bedrock/Vertex/Foundry providers (REJECT, OpenAI-compatible) · **#15** `track_progress` for issues (REJECT, PR-only) · **#16** ephemeral GitHub App (REJECT, composite action). Details in `docs/archive/tasks.md`.

## Known limitations / next steps

1. **~~Pi binary provisioning~~ — DONE.** Both actions are now composite
   actions that install a pinned Pi release idempotently at runtime (see
   "Pi runtime provisioning" above).
2. **`pr-content` engine path** — the pr-content engine options are mapped
   and tested, but its runtime still uses the legacy flow; switching it over
   should mirror the pr-review delegation bridge.
3. **Pre-existing legacy test failures** — 5 failures in
   `dependencyResolver`, `importParser` and `prompts` tests exist on main
   predating the engine work; worth a dedicated cleanup PR.
4. **Evaluation dataset** (spec §34) — fixtures exist for detection
   tests; LLM-judged finding-quality evals remain future work.
5. **Shadow/pilot rollout** (spec §41) — enable per-repo via the
   delegation bridge's presence check before flipping default refs.
