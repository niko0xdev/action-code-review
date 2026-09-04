# V2 vs Claude Code Action (CCA) — Tasks

> Phase-1 audit: 16 candidates cross-checked against `v2/` + `pr-review/` + `pr-content/` + CCA read-only clone at `/tmp/claude-code-action`.
> Hard constraints: keep Pi harness (`v2/src/harness/pi.ts`), V1 interface frozen (`pr-review/action.yml`, `pr-content/action.yml`), one task = one PR (`feat/v2-claude-action-<id>`).

**Legend:** `ADOPT` = ship one PR · `DEFER` = valid but out-of-scope/queued · `REJECT` = not applicable / violates constraints

## Summary (16 candidates)

| # | Tier | Candidate | Verdict | New inputs (if ADOPT) | Notes |
|---|------|-----------|---------|-----------------------|-------|
| 1 | T1 | Mode auto-detection | **ADOPT** | `mode` (`review` only, default `review`) — detection plumbing | CCA `detector.ts:14`; V2 `cli.ts:246` always review |
| 2 | T1 | Write-permission gating | **ADOPT** | `require-write-permissions` (bool, default `false`) | CCA `prepare.ts:40-54`, `permissions.ts:56-120`; V2 no `getCollaboratorPermissionLevel` call |
| 3 | T1 | Buffered inline comments + classification | **ADOPT** | `buffer-inline-comments` (bool, default `true`) + `classify-inline-comments` alias | CCA `post-buffered-inline-comments.ts:1-235`; V2 `review.ts:99-188` posts inline immediately |
| 4 | T1 | `allowed_bots` / actor allowlist | **ADOPT** | `allowed-bots`, `exclude-actors` (CSV, default `""`) | CCA `action.yml:30-54`, `permissions.ts:9-30`; V2 `pr-review/action.yml:8-53` no actor filter |
| 5 | T1 | `use_sticky_comment` (single summary) | **ADOPT** | `sticky-summary` (bool, default `true`) | CCA `action.yml:112-115`; V2 `review.ts:156` always `createComment` |
| 6 | T1 | Progress via structured outputs | **ADOPT** | `track-progress` (bool, default `false`) | CCA `action.yml:136-139`, `detector.ts:16-31`; V2 `cli.ts` no `$GITHUB_STEP_SUMMARY` writes |
| 7 | T2 | `prompt` as raw + template file | **ADOPT** | `review-prompt-file` (path, default `""`) | CCA `action.yml:57-59` prompt/settings; V2 only `review-prompt` |
| 8 | T2 | `claude_args` / `pi_args` passthrough | **ADOPT** | `pi-args` (string, whitelist) | CCA `action.yml:104-107`; V2 `harness/pi.ts:30-46` fixed args |
| 9 | T2 | OIDC / non-standard auth header | **DEFER** | `openai-auth-token-env` + `openai-auth-header` | Already provider-agnostic via `OPENAI_API_*`; low demand, defer post-T1 |
| 10 | T2 | `path_to_claude_code_executable` → `pi-binary-path` | **ADOPT** | `pi-binary-path` (path, default `""`) | CCA `action.yml:144-148`; V2 `harness/pi.ts:20`, `pr-review/action.yml:64-69` always installs |
| 11 | T2 | `include_fix_links` | **DEFER** | `include-fix-links` (bool) | Footer already has `view logs` (`comments.ts:220-230`); value real but queue behind T1 |
| 12 | T2 | `trigger_phrase` for issue-comments | **REJECT** | — | Review-only action; no `issue_comment` trigger in `pr-review.yml`. Out of scope per spec |
| 13 | T3 | `claude_args` system-prompt overrides (dup #8) | **REJECT** | — | Duplicate of #8 |
| 14 | T3 | Multiple auth providers (Bedrock/Vertex/Foundry) | **REJECT** | — | Already OpenAI-compatible (`v2/src/llm/config.ts:35`, `provider.ts:4-18`); Pi stays |
| 15 | T3 | `track_progress` for issues events | **REJECT** | — | Issues events not in scope |
| 16 | T3 | Self-hosted runner vs ephemeral GitHub App | **REJECT** | — | Ships as composite action (`pr-review/action.yml:58`); no App model |

**Adopted:** 9 (T1: 6, T2: 3) · **Deferred:** 2 · **Rejected:** 5

---

## Evidence base

### CCA sources (read-only clone)

- Inputs catalog: `claude-code-action/action.yml:8-160` (40+ inputs vs our 13)
- Mode detection: `claude-code-action/src/modes/detector.ts:14-115` (`detectMode`, `validateTrackProgressEvent`)
- Permission gating: `claude-code-action/src/entrypoints/prepare.ts:40-54` → `src/github/validation/permissions.ts:56-130` (`checkWritePermissions`, `getCollaboratorPermissionLevel`, `allowed_bots`/`allowedNonWriteUsers`)
- Tool allow/deny: `claude-code-action/src/create-prompt/index.ts:14-70` (`buildAllowedToolsString`, `buildDisallowedToolsString`, `BASE_ALLOWED_TOOLS`)
- Buffered inline: `claude-code-action/src/entrypoints/post-buffered-inline-comments.ts:1-235` (`BUFFER_PATH=/tmp/inline-comments-buffer.jsonl`, `classifyComments` via Haiku, `confirmed` partition)
- Security posture: `claude-code-action/docs/security.md:1-80` (write-check, bot control, subprocess scrub)
- Sticky/track/fix/binary: `action.yml:112-115` (`use_sticky_comment`), `:136-139` (`track_progress`), `:141-143` (`include_fix_links`), `:144-148` (`path_to_claude_code_executable`)

### V2 current state (file:line)

- Public surface (frozen): `pr-review/action.yml:8-53` (13 inputs), `pr-content/action.yml:8-35`, `docs/v1-interface-contract.md:1-` (snapshot in `docs/.v1-contract-snapshot/`)
- Orchestrator: `v2/src/cli.ts:246` `parseArgs`, `:249-410` `main()` — no mode/detector branch; `v2/src/adapter/legacy-inputs.ts:1-` maps only frozen inputs
- Publisher: `v2/src/github/review.ts:99-188` `publishReview` — immediate `createReview`/`createReviewComment`/`createComment`; no buffering, no `listComments`/`update` for sticky; no `repos.getCollaboratorPermissionLevel` call; `v2/src/github/comments.ts:120-232` `buildSummaryBody` — no sticky id
- Harness: `v2/src/harness/pi.ts:20` `binaryPath?: string`, `:30-46` `buildPiArgs` fixed `--tools read,grep,find,ls --no-session --mode json`; env `v2/src/harness/pi.ts:80-98` no custom auth header
- Provisioning: `pr-review/action.yml:58-76` composite `Install Pi` + `Run AI Code Review`; skips only when `pi --version` matches `0.73.1` — no `pi-binary-path` bypass
- LLM layer: `v2/src/llm/config.ts:35` reads `OPENAI_API_*`, `v2/src/llm/provider.ts:4-18` provider-agnostic via capabilities — no Bedrock/Vertex/Foundry branch

---

## #1 — Mode auto-detection [ADOPT]

- **CCA:** `detector.ts:14-81` — `track_progress` forces `tag`; comment events check `prompt` → `agent` else `checkContainsTrigger` → `tag`; PR events check `supportedActions` + `prompt`; issues similar. `prepare.ts:30-34` auto-detects before any work.
- **V2:** `v2/src/cli.ts:246` `parseArgs` only distinguishes `pr-review` vs `pr-content`; `main()` unconditionally runs review pipeline. No `mode` input in `pr-review/action.yml:8-53`. No `GITHUB_EVENT_NAME`/`GITHUB_EVENT_ACTION` validation.
- **Verification:** `grep -rn detectMode|trackProgress v2/ pr-review/` → no hits outside `dist/`. CCA mode enum (`tag|agent`) does not map 1:1 — V2 is review-only.
- **Decision:** **ADOPT detection plumbing only.** Add input `mode` (default `review`, enum `review` — document that only `review` is accepted for now; unknown values → warn + fall back to `review`). Implement `src/modes/detector.ts` that validates `GITHUB_EVENT_NAME` ∈ `{pull_request, pull_request_target}` and `GITHUB_EVENT_ACTION` ∈ `{opened,synchronize,ready_for_review,reopened}` (log + early-exit otherwise), and checks optional `trigger-phrase` presence in PR body (gate, not mode switch). Keep Pi.
- **Risks / must not:** No V1 input rename; no SDK swap.

## #2 — Write-permission gating [ADOPT]

- **CCA:** `prepare.ts:40-54` calls `checkWritePermissions(octokit.rest, context, allowedNonWriteUsers, githubTokenProvided)` before trigger check; failure throws `Actor does not have write permissions`. `permissions.ts:56-130` resolves via `repos.getCollaboratorPermissionLevel` and handles `[bot]` suffix + `allowed_bots` fallback.
- **V2:** No permission check. `v2/src/cli.ts:270-320` fetches `fetchPrContext` and proceeds to `publishReview` regardless of `GITHUB_ACTOR`. `v2/src/github/review.ts:99-188` never calls `getCollaboratorPermissionLevel`.
- **Verification:** `grep -rn getCollaboratorPermissionLevel|checkWrite v2/src pr-review/src` → 0 hits.
- **Decision:** **ADOPT with safe default.** Add input `require-write-permissions` (bool, default `false` — preserves current behavior; when `true`, missing write → `core.warning` + skip `APPROVE` event but still post review so external contributors get value). Implementation: `v2/src/github/permissions.ts` thin wrapper around `octokit.rest.repos.getCollaboratorPermissionLevel` (no App isolation/bubblewrap scope). Gate only `APPROVE`/`REQUEST_CHANGES` escalation, not the read-only review itself.
- **New inputs:** `require-write-permissions` only.

## #3 — Buffered inline comments + classification [ADOPT]

- **CCA:** `post-buffered-inline-comments.ts:16-18` `BUFFER_PATH=/tmp/inline-comments-buffer.jsonl`; `:29-44` `CLASSIFICATION_PROMPT` (test/probe vs real); `:46-110` `classifyComments` via `claude-haiku-4-5` with `null` fallback (post all); `:180-230` partitions `confirmed===false` (never post) vs candidates (classify then post via `createReviewComment`).
- **V2:** `v2/src/github/review.ts:116-155` builds `payload` and immediately `createReview` with inline `comments`; fallback loops `createReviewComment`/`createComment`. No buffering, no `confirmed` field, no classification hook. Validation already exists (`v2/src/review/validator.ts` path/line/confidence) but covers different signal (anchoring, not probe detection).
- **Verification:** `grep -rn BUFFER|bufferFinding|flushBuffer v2/src` → 0. Spec §18 validation ≠ CCA probe filter — complementary.
- **Decision:** **ADOPT provider-neutral variant.** Split `publishReview` into `bufferFinding` (append to `/tmp/ai-inline-buffer.jsonl`) during `runReview` + `flushBuffer` after harness completes. Add input `buffer-inline-comments` (bool, default `true`; `false` = current immediate-post). Classification hook calls configured OpenAI-compatible endpoint with tiny prompt (no Anthropic pin); on absence/failure → post all `confirmed !== false` (match CCA fallback). `confirmed=false` never posts.
- **Guard:** Never add `anthropic_api_key` dependency; reuse `OPENAI_API_*`.

## #4 — `allowed_bots` / actor allowlist [ADOPT]

- **CCA:** `action.yml:30-54` `allowed_bots` (`""` = deny all bots, `"*"` = allow all), `include_comments_by_actor`/`exclude_comments_by_actor` with `*[bot]` wildcard; `permissions.ts:9-30` `isAllowedBot` normalizes `[bot]` suffix.
- **V2:** `pr-review/action.yml:8-53` has no actor inputs; `v2/src/cli.ts` and `v2/src/context/pr.ts` never inspect `GITHUB_ACTOR`.
- **Verification:** `grep -rn allowed.*bot|GITHUB_ACTOR v2/ pr-review/` → 0.
- **Decision:** **ADOPT minimal allowlist.** Add `allowed-bots` (CSV, default `""` — deny bots) + `exclude-actors` (CSV, default `""`) to `pr-review/action.yml`. Implement `src/github/actor-filter.ts` with `[bot]`-aware matching + `*[bot]` wildcard (copy CCA semantics, not the OIDC/App plumbing). When actor denied → `core.info` + early exit with `conclusion=skipped` (still post no review). Contract tests must cover.
- **Security note:** Document `allowed-bots="*"` warning (public repos) mirroring CCA `security.md`.

## #5 — `use_sticky_comment` [ADOPT]

- **CCA:** `action.yml:112-115` `use_sticky_comment` (default `false`); tag mode reuses one comment id across re-runs (update vs create).
- **V2:** `v2/src/github/review.ts:156-171` always `issues.createComment` with `buildSummaryBody`; no `issues.listComments` lookup, no `update`. On `synchronize` events this duplicates summaries.
- **Verification:** `grep -rn listComments|update.*Comment v2/src/github` → 0 before this task (only `listReviews`/`listCommentsForReview` for dedupe).
- **Decision:** **ADOPT.** Add input `sticky-summary` (bool, default `true` — V2 summaries are deterministic; sticky is the safer default for review actions). Implementation: compute `marker = <!-- ai-review-summary:${owner}/${repo}#${prNumber} -->` appended to `buildSummaryBody`; in `publishReview` call `issues.listComments` (paginated, filter by `user.login === auth.login` + marker) → `issues.updateComment` if found else `createComment`. Keep `update` in `PublisherOctokit` interface (already present `update?:` via OctokitLike extension point).
- **File:line after:** `v2/src/github/review.ts:156` becomes sticky branch.

## #6 — Progress tracking via structured outputs [ADOPT]

- **CCA:** `action.yml:136-139` `track_progress` (bool, default `false`) — only for `pull_request`/`issues`/`issue_comment`/etc. (`detector.ts:16-31` validates). Tag mode emits JSON progress blob → Action output `structured_output`.
- **V2:** No progress reporting. `v2/src/cli.ts:260-400` logs via `core.info` only. No `$GITHUB_STEP_SUMMARY` writes, no `track-progress` input.
- **Verification:** `grep -rn GITHUB_STEP_SUMMARY|track_progress v2/` → 0.
- **Decision:** **ADOPT lightweight.** Add input `track-progress` (bool, default `false`). When enabled, CLI emits `$GITHUB_STEP_SUMMARY` sections as it walks `fetchPrContext → prioritizeFiles → resolveProfiles → Pi review → validate/dedupe/cap → publish`, with phase counts and duration. No `track_progress` event validation beyond PR PR events (match CCA `validateTrackProgressEvent` but scoped to `pull_request` only). Output via existing `core.setOutput` compatible path; no new `structured_output` schema yet (defer structured JSON to follow-up if requested).
- **Default false** keeps silent behavior unchanged.

## #7 — Structured `prompt` as raw + template file [ADOPT]

- **CCA:** `action.yml:57-59` `prompt` (direct string) + `settings` (JSON/file path); `create-prompt/index.ts` merges into SDK prompt.
- **V2:** `pr-review/action.yml:22-26` only `review-prompt` (string, default correctness/security/...). No file input. `v2/src/cli.ts:280-310` maps `review-prompt` verbatim into `extraRules`.
- **Verification:** `grep -rn review-prompt-file|PROMPT_FILE v2/` → 0. V1 contract (`docs/v1-interface-contract.md`) lists only `review-prompt`.
- **Decision:** **ADOPT additive.** Add `review-prompt-file` (string path, default `""`) to `pr-review/action.yml`. In `cli.ts` if set, `readFile` (cap 50 KiB, UTF-8) and prepend to Pi prompt (`promptFile + "\n\n" + reviewPrompt`). If both empty → use default. No existing input renamed. Document that file path is repo-relative and read with `fs/readFile` (no network).
- **Priority:** Low-risk, high-ergonomics; ships early in T2 wave.

## #8 — `claude_args` / `pi_args` passthrough [ADOPT]

- **CCA:** `action.yml:104-107` `claude_args` (string → SDK flags). `create-prompt/index.ts:14-70` allow/disallow tool strings shape the prompt surface.
- **V2:** `v2/src/harness/pi.ts:30-46` `buildPiArgs` returns fixed `--tools read,grep,find,ls --no-session --no-skills --mode json`; no caller-supplied flags.
- **Verification:** `grep -rn pi-args|claude_args v2/` → 0.
- **Decision:** **ADOPT whitelisted passthrough.** Add `pi-args` (string, default `""`) to `pr-review/action.yml`. Forward only allowlisted flags: `--max-turns`, `--max-duration`, `--model-override` (mapped to `--model`), `--no-session` (already set). Reject anything containing `--tools`, `--provider`, `--mode`, shell metachars, or `--` prefix outside whitelist (log warning, drop). Pass via `buildPiArgs` extra spread.
- **Security:** Whitelist prevents escaping read-only harness (`PI_READONLY_TOOLS` invariant).

## #9 — OIDC / federation for non-OpenAI providers [DEFER]

- **CCA:** `action.yml:73-102` `anthropic_federation_rule_id`, `anthropic_organization_id`, `use_bedrock|vertex|foundry` with OIDC token exchange; docs `configuration.md` details.
- **V2:** Already provider-agnostic (`v2/src/llm/config.ts:35-52` reads `OPENAI_API_URL`/`OPENAI_API_KEY`/`OPENAI_API_MODEL`; `v2/src/llm/provider.ts:4-18` branches on capabilities, not model names). Works with LiteLLM/vLLM/zrouter per `docs/v2-architecture.md`.
- **Verification:** `pr-review/action.yml` consumers already route via `openai-base-url` + `OPENAI_API_*` env without OIDC. No demand signal in `.orchestration/audit/` for OIDC.
- **Decision:** **DEFER.** Gap is real (gateways requiring non-standard `Authorization` header / token env) but T1 delivers more value per PR. Queue for post-T1 if a consumer needs zrouter/vLLM bearer variant. Shipped form would be `openai-auth-token-env` + `openai-auth-header` (default `Authorization: Bearer`) — tiny, reversible.

## #10 — `path_to_claude_code_executable` → `pi-binary-path` [ADOPT]

- **CCA:** `action.yml:144-148` `path_to_claude_code_executable` — skip install when set; warning about version skew.
- **V2:** `v2/src/harness/pi.ts:20` `binaryPath?: string` already exists but never wired to an input; `pr-review/action.yml:58-68` composite always runs `Install Pi` guard (`command -v pi` + version check). No input to bypass.
- **Verification:** `grep -rn pi-binary-path|PATH_TO_CLAUDE v2/ pr-review/` → 0; `PiHarness` option exists but unused from action surface.
- **Decision:** **ADOPT.** Add `pi-binary-path` (path, default `""`) to `pr-review/action.yml`. When set and executable → skip composite install step (`if: inputs.pi-binary-path == ''`) and pass to `new PiHarness({ binaryPath })`. Mirror CCA guard: `test -x` check, `core.warning` + fallback to `pi` on miss. No new dependency.
- **Value:** Self-hosted runners with pinned Pi, hermetic builds.

## #11 — `include_fix_links` [DEFER]

- **CCA:** `action.yml:141-143` `include_fix_links` (default `true`) — appends "Fix this" deep link that re-invokes Claude in context.
- **V2:** Footer in `v2/src/github/comments.ts:220-230` renders `Generated by ... using <model> · view logs`; no per-finding fix link. Per-finding body in `comments.ts:48-66` has no link row.
- **Verification:** `grep -rn fix.*link|Fix this v2/src` → 0.
- **Decision:** **DEFER.** Useful but not blocking; V2 decision banner + blocking findings already convey actionability. When adopted, append `https://github.com/{owner}/{repo}/pull/{pr}#discussion_r{commentId}` (or repo's `actions/ai-review-reply` workflow if detected) conditioned on `include-fix-links` (default `true` to match CCA). Queue behind T1 to avoid footer churn in the same PR as sticky-summary.

## #12 — `trigger_phrase` analog for issue-comments [REJECT]

- **CCA:** `action.yml:8-9` `trigger_phrase` default `@claude`; `detector.ts:34-48` `checkContainsTrigger` gates `tag` mode on issue/PR comments.
- **V2:** Review-only action triggered by `pull_request` (`opened,synchronize,reopened,ready_for_review`) — see `.github/workflows/pr-review.yml:3-5`. No `issue_comment` trigger, no chat-bot surface.
- **Decision:** **REJECT.** Out of scope for this repo. Document in `docs/v2-architecture.md` that issue-comment activation is intentionally unsupported; revisit only if a `claude`-mention issue workflow is product-requested. No input added.

## #13 — `claude_args` system-prompt overrides (dup) [REJECT]

- **Duplicate of #8.** Same `action.yml:104-107` source. No separate implementation.

## #14 — Multiple auth providers (Bedrock/Vertex/Foundry) [REJECT]

- **CCA:** `action.yml:91-102` `use_bedrock|vertex|foundry` + OIDC federation.
- **V2:** `v2/src/llm/provider.ts:4-18` documents provider-agnostic gateway (OpenAI-compatible). `v2/src/llm/openai-compatible.ts:1-45` is the only wire protocol. No Bedrock SDK needed.
- **Decision:** **REJECT.** Would require swapping Pi's provider wiring for Claude SDK — violates hard constraint "keep Pi as harness — no Claude Code SDK swap". Existing `OPENAI_API_*` env already covers zrouter/LiteLLM/vLLM.

## #15 — `track_progress` for issues events [REJECT]

- **CCA:** `detector.ts:83-98` validates `track_progress` for `issues` events; `prepare.ts:16-31` gates on it.
- **V2:** No issues review path. `v2/src/cli.ts:258` checks `context.payload.pull_request` and fails otherwise.
- **Decision:** **REJECT.** Issues review out of scope (same rationale as #12).

## #16 — Self-hosted runner vs ephemeral GitHub App [REJECT]

- **CCA:** Ships as GitHub App + composite action with ephemeral `installation/token` (`prepare.ts:37-38` `setupGitHubToken`, `action.yml:448-459` revoke). `docs/security.md` scopes token to repo.
- **V2:** Ships as composite action (`pr-review/action.yml:58` `using: composite`) — no App, no token minting. Runner is whatever consumer provides.
- **Decision:** **REJECT.** App model is an architectural alternative, not an improvement to adopt. V2's composite + `INPUT_*` forwarding is already correct for this repo.

---

## Execution plan (one task = one PR)

Branches: `feat/v2-claude-action-<id>` off `main`. Each PR: `pnpm test && pnpm typecheck && pnpm lint` green; `v2/tests/contract.test.ts` green; no V1 input renames.

| Order | Branch | Task | Files |
|-------|--------|------|-------|
| 1 | `feat/v2-claude-action-01-detector` | #1 mode detection plumbing | `pr-review/action.yml`, `v2/src/modes/detector.ts`, `v2/src/cli.ts`, tests |
| 2 | `feat/v2-claude-action-02-permissions` | #2 write-permission gating | `pr-review/action.yml`, `v2/src/github/permissions.ts`, `v2/src/cli.ts` or `review.ts`, tests |
| 3 | `feat/v2-claude-action-03-buffer` | #3 buffered inline + classify | `pr-review/action.yml`, `v2/src/github/buffer.ts`, `v2/src/github/review.ts`, tests |
| 4 | `feat/v2-claude-action-04-actor-filter` | #4 actor allowlist | `pr-review/action.yml`, `v2/src/github/actor-filter.ts`, tests |
| 5 | `feat/v2-claude-action-05-sticky` | #5 sticky summary | `pr-review/action.yml`, `v2/src/github/review.ts`, `v2/src/github/comments.ts`, tests |
| 6 | `feat/v2-claude-action-06-progress` | #6 progress tracking | `pr-review/action.yml`, `v2/src/cli.ts`, `v2/src/github/progress.ts`, tests |
| 7 | `feat/v2-claude-action-07-prompt-file` | #7 review-prompt-file | `pr-review/action.yml`, `v2/src/cli.ts`, tests |
| 8 | `feat/v2-claude-action-08-pi-args` | #8 pi-args whitelist | `pr-review/action.yml`, `v2/src/harness/pi.ts`, tests |
| 9 | `feat/v2-claude-action-10-binary-path` | #10 pi-binary-path | `pr-review/action.yml`, `v2/src/harness/pi.ts`, `v2/src/cli.ts`, tests |

Deferred (queue after T1, implement if time/bandwidth):
- #9 OIDC/custom auth header (`openai-auth-token-env`/`openai-auth-header`)
- #11 `include_fix_links`

Rejected: #12, #13, #14, #15, #16 (documented above).

## Contract & safety checklist (per PR)

- [ ] New inputs only; `docs/.v1-contract-snapshot/*.action.yml` snapshot compared in `v2/tests/contract.test.ts`
- [ ] `niko0xdev <niko0xdev@gmail.com>` author; no `Co-Authored-By` trailer
- [ ] `pnpm test && pnpm typecheck && biome check` green
- [ ] Pi stays the harness; no Claude SDK import
- [ ] Never commit to `main` directly (`gh pr create` + `gh pr merge --squash`)

## Docs follow-up

After T1 merges, append `## Patterns aligned with CCA` to `docs/v2-architecture.md` with per-pattern source links, V2 file:line mapping, and deferred/rejected rationale.

