# Phase 2 — Hardening (41 MEDIUM findings → 17 clusters after dedupe)

This is the implementation brief for Claude Code session `cc-v2-audit-phase-2`.

## Post-Phase-1 context

Phase 1 (PR #32, commit 8fd5708) fixed 15 CRITICAL/HIGH blockers. V2 is now functional but MEDIUM findings remain. Phase 2 addresses hardening + quality + rule coverage. Phase 3 (LOW/INFO polish) follows.

## 17 dedupe clusters (H1..H17)

| Cluster | Findings (raw) | File(s) | Fix |
|---------|----------------|---------|-----|
| **H1** | F-001 React, F-002 NextJS, F-002 NestJS, F-002 Python uv, F-003 NodeJS, F-003 Python PEP 621, F-003 Swift 6, F-004 TS 5.4-5.6 + ES2024, F-004 Kotlin 2.0, F-005 async/API, F-005 FastAPI/Pydantic, F-006 Python closure/generator, F-004 profile tests, F-005 profile tests, F-007 profile tests | `v2/src/profiles/rules.ts`, `v2/src/profiles/index.ts`, `v2/tests/profiles/detect.test.ts` | Add concrete rules per stack (React 19 form/action, NextJS 15 cache/parallel routes, NestJS hybrid+Fastify, Python uv/PEP 621/Pydantic v2/FastAPI/asyncio, Swift 6 Sendable/actor/withTaskGroup/Observation, Kotlin 2.0/Coroutines/Compose 1.7/derivedStateOf, TS 5.4-5.6 NoInfer/Object.groupBy/RegExp.escape, JS ES2024). Strengthen universal fallback (validate against ProfileId type). Add rule-content asserts in detect.test.ts. |
| **H2** | F-005 (security) HTML escape | `v2/src/github/comments.ts:39-58` | Add `mdSafe()` helper. Apply to title/description/impact before concatenation. Add test fixture with `<img onerror>` payload. |
| **H3** | F-004 Pi install guard | `pr-review/action.yml:64-69`, `pr-content/action.yml:38-43` | After `command -v pi`, also assert `pi --version` starts with `0.73.1`. If not, reinstall with `--ignore-scripts`. |
| **H4** | F-004 `as never` bypass | `v2/src/cli.ts:114` | Replace `as never` with proper `PublisherOctokit` cast or refactor boundary. |
| **H5** | F-004 riskFromFindings, F-008 listTopLevel/fileExists/ReviewCommentWire/buildReplyBody, F-006 RepositoryInfo.defaultBranch, F-009 _context dead param, F-007 DiffInfo.truncated unused | various in `v2/src/` | Delete dead exports + remove dead param + remove unused fields from types. Keep `DiffInfo.truncated` field but assert at least one consumer reads it OR remove. |
| **H6** | F-006 prompt-injection depth | `v2/src/harness/harness.ts:60-65` (post Changed files section) | Add second defense paragraph at end of prompt after file content. |
| **H7** | F-007 reply trust | `v2/src/github/review.ts:132-153` | Before posting reply, fetch original comment via `octokit.rest.pulls.getReviewComment` and assert (a) PR matches, (b) author matches the bot or original reviewer, (c) body has `<!-- ai-review-id:... -->` marker. Fail closed. |
| **H8** | F-007 sequential Pi spawns | `v2/src/review/reviewer.ts:47-64` | Switch to `Promise.allSettled` with concurrency=3 (use `p-limit` or manual chunking). Add early-cancel signal if downstream publish is doomed (skip if previous group yielded zero valid findings AND remaining files are unchanged). |
| **H9** | F-008 pagination retry | `v2/src/context/pr.ts:107-128` | Add retry/backoff loop with 3 attempts on 403/429 with `Retry-After` header. |
| **H10** | F-010 Pi timeout, F-011 LLM timeout, F-008 INPUT_* parity test | `v2/src/cli.ts`, `v2/src/adapter/runtime.ts`, `v2/tests/contract.test.ts` | Read `AI_REVIEW_PI_TIMEOUT_MS` and `AI_REVIEW_LLM_TIMEOUT_MS` env vars with safe fallback. Add contract test asserting every action.yml input has corresponding `INPUT_<NAME>` env key with hyphens preserved. |
| **H11** | F-003 profile universal fallback | `v2/src/profiles/index.ts:17-24` | Validate comma-separated `AI_REVIEW_PROFILE` against valid `ProfileId` keys; warn and ignore invalid IDs. |
| **H12** | F-006 + F-004 e2e fixture | `v2/tests/e2e/pipeline.test.ts:21-40` | Switch fixture dir to per-test `mkdtemp`. Add a second fixture with multi-stack (TS + Python) files. |
| **H13** | F-005 contract test strict | `v2/tests/contract.test.ts:95-98` | Add `expect(actionYamlDefaults).toEqual(frozenDefaults)` instead of `toContain`. |
| **H14** | F-008 architecture docs | `docs/v2-architecture.md:164-174` | Update §Optional configuration table to reflect currently implemented vs documented-but-not-implemented. Add note for `AI_REVIEW_PI_TIMEOUT_MS` once H10 lands. |
| **H15** | F-005 legacy inputs dropped (post-Phase-1 verification) | `v2/src/adapter/legacy-inputs.ts`, `v2/src/cli.ts`, `v2/src/review/*` | Verify post-Phase-1 that `reviewPrompt`, `autoApproveWhenResolved`, `minSeverity`, `includeFullContent`, `maxContextChars` are all consumed in V2 path (not just parsed). If any are parsed-but-dropped, wire them. |
| **H16** | F-005 example workflow permissions | `pr-content/.github/workflows/example.yml:6-16` | Add `permissions: pull-requests: write contents: read`. |
| **H17** | F-009 Promise.all fail-fast | `v2/src/context/pr.ts:61-67` | Switch to `Promise.allSettled` or accept (low priority; only change if a test requires partial metadata). |

## Out-of-scope for Phase 2

Move to Phase 3 (LOW/INFO):
- All F-006..F-015 perf items that didn't make Phase 1 or 2
- Stack rule sub-detail (F-004 of stack reviews) — only H1 captures the major stack rules
- Test-quality F-005..F-008

## Files to edit

- `v2/src/profiles/rules.ts` (H1 — major addition)
- `v2/src/profiles/index.ts` (H11)
- `v2/src/profiles/common.ts` (if profile detection needs strengthening)
- `v2/src/github/comments.ts` (H2)
- `pr-review/action.yml` (H3)
- `pr-content/action.yml` (H3)
- `v2/src/cli.ts` (H4, H8, H10, H15)
- `v2/src/review/reviewer.ts` (H8, H15)
- `v2/src/harness/harness.ts` (H6)
- `v2/src/harness/pi.ts` (H5 — dead param)
- `v2/src/github/review.ts` (H7)
- `v2/src/context/pr.ts` (H9, H17)
- `v2/src/context/repository.ts` (H5)
- `v2/src/types/context.ts` (H5)
- `v2/src/types/finding.ts` (H5)
- `v2/src/review/severity.ts` (H5)
- `v2/src/adapter/legacy-inputs.ts` (H15)
- `v2/tests/profiles/detect.test.ts` (H1 — rule-content asserts)
- `v2/tests/contract.test.ts` (H10, H13)
- `v2/tests/e2e/pipeline.test.ts` (H12)
- `v2/tests/github/comments.test.ts` (if exists; add H2 test)
- `pr-content/.github/workflows/example.yml` (H16)
- `docs/v2-architecture.md` (H14)

## Tests that MUST exist after fix

1. `v2/tests/profiles/detect.test.ts` — assert each profile's rules include the new stack-specific items (substring match against `PROFILE_RULES[profileId]`)
2. `v2/tests/github/comments.test.ts` — new file. Test:
   - Finding with `<img onerror=...>` in title → body renders as literal text, not HTML
   - Finding with `javascript:` URL in description → escaped
3. `v2/tests/harness/harness.test.ts` (or add to existing) — test that prompt includes defense paragraph at end
4. `v2/tests/github/review.test.ts` — test reply trust checks (mock getReviewComment returning wrong PR → throw)
5. `v2/tests/review/reviewer.test.ts` — test concurrency limit (mock harness with delay, assert max 3 concurrent)
6. `v2/tests/context/pr.test.ts` — test pagination retry on 429
7. `v2/tests/contract.test.ts` — test `actionYamlDefaults === frozenDefaults`, test INPUT_* parity
8. `v2/tests/e2e/pipeline.test.ts` — add multi-stack fixture

## Hard rules (do not break)

- **V1 contract frozen**: no rename/remove of inputs/outputs
- **Pi version pin**: `0.73.1` everywhere
- **No new dependencies** without justification
- **No Co-Authored-By / Signed-off-by trailers**
- **No force-push to main**
- **Single commit** for this phase (or 2 if needed)
- **Branch**: `feat/v2-audit-phase-2-hardening` (already created)
- **No regression**: existing 187 V2 tests must still pass

## Final report format (BẮT BUỘC)

Write `/tmp/cc-v2-audit-phase-2-result.md`:
```
## SUMMARY
<2-3 sentences: what was hardened, files changed, lines added/removed>

## EVIDENCE
- pnpm test: <output snippet, last 10 lines>
- pnpm typecheck: <output snippet>
- pnpm lint: <output snippet>
- pnpm build: <output snippet>
- git log -1: <commit hash + message>
- gh pr create: <PR URL>

## ASSUMPTIONS
- <any assumption about V1 contract interpretation>
- <any decision you made for ambiguous spec>
- <any test that you intentionally did not add and why>
```

## Auto-approve (from user)

User has authorized "tự approve" for this phase:
- git commit/push: OK
- gh pr create: OK
- Worktree operations: OK
- Branch operations on feat/v2-audit-phase-2-hardening: OK

DO NOT:
- Modify code outside the listed files
- Force-push to main or any shared branch
- Delete branches or worktrees
- Touch .github/workflows/* (separate workflow)

## Stop conditions

DỪNG when ALL of:
1. All 17 clusters (H1..H17) implemented per spec
2. `cd v2 && pnpm test && pnpm typecheck && pnpm lint` all green
3. `cd pr-review && pnpm run build && pnpm run lint` all green
4. `cd pr-content && pnpm run build && pnpm run lint` all green
5. Single commit on `feat/v2-audit-phase-2-hardening`, no Co-Authored-By trailers
6. `gh pr create --base main --head feat/v2-audit-phase-2-hardening` succeeded
7. `/tmp/cc-v2-audit-phase-2-result.md` written

DO NOT merge. Nim reviews + merges.
