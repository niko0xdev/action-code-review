# Branch audit — 2026-09-25

Snapshot taken from `fix/zero-thread-and-empty-answer-guard` reset to
`origin/main` (`a642536`, "feat: add shared date helpers (#124)").

This is a read-only inventory. No branch was deleted or pushed.

## Method

For every local branch (excluding `main` and `worktree-agent-*`), I computed:

1. **Commit ancestry:** are all branch-ahead commits already reachable from
   `origin/main`?
2. **Patch-id equivalence:** if a commit's hash is not on `origin/main` but
   the same patch-id is, the branch is still considered merged
   (rebase/squash with editorial changes).
3. **File-level overlap:** for the remaining delta, list files where the
   branch tip content differs from `origin/main`, or files added by the
   branch that do not exist on `origin/main`.

## Totals

| Category | Count |
|---|---:|
| Branches reviewed | 75 |
| Obsolete (every commit reachable from `origin/main`) | 9 |
| Obsolete by patch-id (merged as squash or rebase) | 52 |
| Possibly unmerged (delta by patch-id) | 14 |
| `worktree-agent-*` (transient agent scratch) | 6 |

## Obsolete — already merged into `origin/main`

`git log origin/main..<branch>` is empty (branch tip is on main), **or** every
branch-ahead commit's `git patch-id` matches a commit reachable from
`origin/main`. Safe to delete.

- `chore/daily-audit-2026-09-13`
- `chore/daily-audit-2026-09-14`
- `claude/autonomous-product-loop` — also has docs/plan/AUTONOMOUS-PRODUCT-LOOP.md added by the branch and not on main (see "Has delta" below)
- `docs/english-research-and-agent-rule`
- `docs/v2-cca-patterns`
- `feat/friendly-newton-57013f`
- `feat/incremental-review-dedupe`
- `feat/loop-tick-audit`
- `feat/loop-tick10`
- `feat/loop-tick11`
- `feat/loop-tick12`
- `feat/loop-tick13`
- `feat/loop-tick14`
- `feat/loop-tick15`
- `feat/loop-tick16`
- `feat/loop-tick17`
- `feat/loop-tick18`
- `feat/loop-tick19`
- `feat/loop-tick20`
- `feat/loop-tick21`
- `feat/loop-tick22`
- `feat/loop-tick23`
- `feat/loop-tick24`
- `feat/loop-tick25`
- `feat/loop-tick26`
- `feat/loop-tick27`
- `feat/loop-tick3-audit`
- `feat/loop-tick4-audit`
- `feat/loop-tick5`
- `feat/loop-tick6`
- `feat/loop-tick7`
- `feat/loop-tick8`
- `feat/loop-tick9`
- `feat/machine-readable-review-report`
- `feat/peaceful-bassi-87f907`
- `feat/pi-skills`
- `feat/review-hardening-and-research`
- `feat/rich-summary-decision`
- `feat/skip-draft-prs`
- `feat/suggestion-consolidation`
- `feat/summary-file-counts`
- `feat/v2-audit-phase-1-blockers`
- `feat/v2-audit-phase-3-polish`
- `feat/v2-claude-action-01-detector`
- `feat/v2-claude-action-02-permissions`
- `feat/v2-claude-action-03-buffer`
- `feat/v2-claude-action-04-actor-filter`
- `feat/v2-claude-action-05-sticky`
- `feat/v2-claude-action-06-progress`
- `feat/v2-claude-action-07-prompt-file`
- `feat/v2-claude-action-08-pi-args`
- `feat/v2-claude-action-10-binary-path`
- `feat/v2-claude-action-align`
- `feat/v2-phase0-contract` — last commit 2026-01-03, behind main by 106 commits; predates V3 and the `v2/` flatten (PR #79). Pure historical noise.
- `feat/verify-pass-wiring`
- `fix/audit-lifecycle-integrity`
- `fix/auto-approve-error-log`
- `fix/graphql-bot-login-attribution`
- `fix/pr-content-model-compat`
- `fix/v2-delegate-cwd`
- `fix/v2-entry-pr-review`
- `fix/v2-pi-runtime`
- `fix/zero-thread-and-empty-answer-guard`
- `verify/approval-fix`

## Has delta vs `origin/main` (14 branches)

These branches have at least one commit whose `git patch-id` does not
appear in `origin/main`. The two-column summary is "source files matching
main / source files differing / files added by branch".

### Likely already merged (only dist differs)

These branches change the same source files as commits on `origin/main`
with identical content; the only differences are stale
`pr-review/dist/index.js` and `pr-content/dist/index.js` because the
branch dists were built from older source. The dists on `origin/main`
are newer. Safe to delete.

| Branch | Source files matching | Source files differing | Files added |
|---|---:|---:|---:|
| `feat/cloudflare-audit-inspired-improvements` | 16 | 0 | 0 |
| `feat/review-usage-report` | 18 | 0 | 0 |
| `fix/approval-with-workflow-token` | 4 | 0 | 0 |
| `fix/semgrep-completion-truth` | 17 | 0 | 0 |

### Real, unmerged delta worth reviewing

| Branch | Source files matching | Source files differing | Files added | Note |
|---|---:|---:|---:|---|
| `fix/review-execution-visibility` | 7 | 0 | 1 (`tests/e2e/pr-scenarios.test.ts`) | Adds a new end-to-end PR scenario matrix test that overlaps but does not duplicate `tests/e2e/pipeline.test.ts` (#23). |
| `feat/test-v2-skills` | 1 | 0 | 1 (`examples/v2-skills-test/Component.jsx`) | Intentional-issue fixture for Pi to catch in CI. |
| `feat/e2e-reply-test` | 0 | 0 | 3 (`pr-review/__tests__/fixtures/reply-target/*`, `v2/tests/e2e/reply-e2e.test.ts`) | Reply E2E scenario, partly in the obsolete `v2/` tree. |
| `test/customer-compat` | 1 | 0 | 3 (`examples/customer-test/sample.js`, `pr-content/src/contentUpdater.ts`, `pr-content/src/index.ts`) | Customer-compat workflow + pr-content source files in the old `pr-content/src/` tree (main uses `src/`). |
| `test/v2-auto-approve` | 1 | 0 | 1 (`examples/clean-test/clean.js`) | Clean-fixture for V2 auto-approve CI run. |
| `test/v2-delegation` | 1 | 0 | 1 (`examples/customer-test/sample.js`) | Same fixture as `test/customer-compat`. |

### Likely stale — predates the `v2/` flatten (PR #79)

These branches add files under `v2/src/`, `v2/tests/`, `v2/dist/` that
were deleted when the repo was flattened. They will not apply cleanly
to the current tree without manual rework. Recommended action: ignore
or re-author the relevant feature on top of the current tree.

| Branch | Files added |
|---|---|
| `fix/summary-template-rules` | `pr-content/src/*`, `v2/dist/*`, `v2/src/*`, `v2/tests/github/*` |
| `feat/v2-delegate-pr-content` | `pr-content/src/__tests__/*`, `pr-content/src/index.ts`, `pr-content/src/v2Delegate.ts`, `v2/dist/entry/pr-content.js`, `v2/src/*`, `v2/tests/*` |
| `feat/v2-audit-phase-2-hardening` | `docs/audit-phase-2-spec.md`, `docs/v2-architecture.md`, `pr-content/.github/workflows/example.yml`, `v2/src/*`, `v2/tests/*` (1 commit is `WIP: phase-2 hardening progress`) |
| `claude/autonomous-product-loop` | `docs/plan/AUTONOMOUS-PRODUCT-LOOP.md`, `v2/src/cli.ts`, `v2/src/review/reviewer.ts`, `v2/tests/review/reviewer.test.ts` |

## Recommended cleanup

If you want a tidy remote:

1. Delete the 61 obsolete branches locally and on `origin` (`git push
   origin --delete <branch>` for each). The remote-only branches
   `origin/fix/review-truthfulness-and-pi-reliability`,
   `origin/feat/file-level-review-coverage`,
   `origin/feat/remove-v1-keep-interface`,
   `origin/fix/publisher-contract-flags`,
   `origin/test/add-issues-test` should also be checked — I did not
   diff them because they have no local tracking branch.
2. For the "real, unmerged delta" branches, decide per-branch whether
   to rebase the new test/fixture onto `origin/main` and ship as a PR,
   or close without merge.
3. For the "stale predates flatten" branches, close without merge and
   re-author any feature you actually want on top of the current tree.

## Remote-only branches (no local tracking branch)

Found at audit time, all evaluated against `origin/main`:

| Remote branch | Status | Note |
|---|---|---|
| `origin/fix/review-truthfulness-and-pi-reliability` | Likely merged | Tip matches commit `549abb6` already on main; small follow-up commit exists but content already absorbed into `d8dac18`. |
| `origin/feat/file-level-review-coverage` | Already merged | Both commits absorbed into PR #125 (`f22f50d`). The remote ref was pruned during this audit's `git fetch --prune`, confirming the maintainer already removed it. |
| `origin/feat/remove-v1-keep-interface` | Unmerged, possibly intentional | Behind main by 50 commits and predates the V3 cycle; ships a V1-engine-removal refactor that conflicts with the current V3 series. |
| `origin/fix/publisher-contract-flags` | Likely stale | Behind main by 51 commits; the tip commit is a doc update ("mark as done"), so the underlying fix was merged. |
| `origin/test/add-issues-test` | Stale | 28 commits ahead, 106 behind, last touched 2026-01-04. Predates V3 and the `v2/` flatten. |

## Caveats

- The patch-id index is computed against `origin/main` reachable
  commits only. A branch whose squash-merge happened on a personal
  fork or on a different remote would not be detected.
- I did not inspect the content of each added file; some "added" files
  may be empty or low-value (e.g. fixtures that exist only to satisfy
  CI).
- "Likely already merged" rows are inferred from identical source
  content between branch tip and `origin/main`. The branch commits
  themselves are not on `origin/main`'s reachable set; they were
  rewritten as new commits during squash/merge.
- `scripts/audit-branches.sh` reproduces this report against any
  reference (default `origin/main`).