# Autonomous Product Loop — action-code-review

> Loop controller: `claude/autonomous-product-loop` @ `c326e08` (base `origin/main`)
> Worktree: `.claude/worktrees/cc-product-loop` — never write to primary checkout or `review-claude-action`

## Research sources (dated evidence)

| # | Source | Citation | Observed | Confidence |
|---|--------|----------|----------|------------|
| 1 | `anthropics/claude-code-action` | `action.yml:140-143` (`include_fix_links` default true) | Deep link per finding; deferred until Pi has a real URI target (`v2-architecture.md:195`) | med |
| 2 | `qodo-ai/pr-agent` | `pr_agent/settings/configuration.toml:179,193,206` | `commitable_code_suggestions` (default false, V2 always commitable), `suggestions_score_threshold` (0-10), self-review checkbox + `approve_pr_on_self_review` — maps to `suggestions.ts:36` / `validator.ts:42` / `approvalManager.ts` | high |
| 3 | `reviewdog/reviewdog` | `filter/diff_filter.go:17`, `README.md:903,910` | `filter-mode` (`added` default) and `-fail-level`/`-fail-on-error`; V2 hard-anchors to added lines (`v2-architecture.md:82`), `block-on-issues` only does `REQUEST_CHANGES` not `core.setFailed` | high |
| 4 | Prior deep audit | `.orchestration/audit/.all-findings-done` 2026-08-31 — 93 findings (15 CRITICAL, 18 HIGH) | `PHASE-1-SPEC.md` 15 deduped clusters C1..C20; branch `feat/v2-audit-phase-1-blockers:bfed1b2` covers contract/harness gaps | high |

## Current-product audit

| Area | File:line | Finding | Status |
|------|-----------|---------|--------|
| V1 contract — `block-on-issues` ignored | `v2/src/github/review.ts:157-189` | `hasBlockingFinding` ignores `params.blockOnIssues` → always `REQUEST_CHANGES` | **fix this loop** |
| V1 contract — unconditional approval | `v2/src/github/review.ts:265-279` | Approves on `findings==0 \|\| !hasBlockingFinding` — flag `auto-approve-when-resolved` never checked | **fix this loop** |
| V1 contract — input never passed | `v2/src/cli.ts:685-708`, `legacy-inputs.ts:250` | `autoApproveWhenResolved` mapped but not forwarded to `PublishParams` | **fix this loop** |
| Reviewer — outage looks clean | `v2/src/review/reviewer.ts:74-79` | Swallowed `Promise.allSettled` rejections → empty result approved at 265 | **fix this loop** |
| Security — prompt-file escape | `v2/src/cli.ts:731-755` | `resolve(repo, file)` without `isAbsolute`/`relative` containment | **fix this loop** |
| Composite inputs | `pr-review/action.yml:14-210` | 40+ inputs after `feat/v2-claude-action-*` waves — contract tests guard V1; new inputs additive only | ok |
| Delegation bridge | `v2/dist/entry/*` | Tracked bundles present, `pr-review/dist/index.js` delegates via `runViaV2IfAvailable` | ok |

## Decisions

| Candidate | Verdict | Reason |
|-----------|---------|--------|
| Honor `block-on-issues` in publisher | **ADOPT** | Fixes published contract violation; smallest diff, add 1 test |
| Gate approval on `autoApproveWhenResolved` + resolved-thread check + `failedGroups` | **ADOPT** | V1 contract requires opt-in + `areAiCommentsResolved` semantics; prevents clean-on-outage approval |
| Enforce `review-prompt-file` repo-relative containment | **ADOPT** | Repo-controlled input must not read `/etc/*` into LLM prompt |
| `failedGroups` diagnostic + thread paginator plumbing | **ADOPT** | One field + one `/threads` paginator; keeps partial-failure surface visible |
| `suggestions` toggle, `filter-mode`, `fail-level` (research #1-4) | **DEFER** | Additive, lower risk than contract fixes; queue after `fix/publisher-contract-flags` |
| Harness swap / new security engines | **REJECT** | Out of architecture scope |

## Task queue

| # | Task | Branch | Status | PR | Evidence |
|---|------|--------|--------|----|----------|
| 1 | `block-on-issues` + approval contract + harness failure + prompt-file containment | `fix/publisher-contract-flags` | `done` | https://github.com/niko0xdev/action-code-review/pull/74 | `fbc7e47` — gates: V2 409 pass, typecheck + lint clean within worktree, `v2/dist` rebuilt |
| 2 | Remaining Phase-1 clusters (C1..C20 audit) | `feat/v2-audit-phase-1-blockers` | `deferred` | — | `.orchestration/audit/PHASE-1-SPEC.md` — requires single commit + contract pin tests; out of scope for smallest high-value fix |
| 3 | Additive inputs from comparables (#1 commitable suggestions, #4 fail-level) | — | `pending` | — | queued until task 1 merges |

Next audit: after task 1 merges, re-check comparables and remaining `PHASE-1-SPEC.md` clusters.
