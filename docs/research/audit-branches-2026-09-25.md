# Branch audit — 2026-09-25

Snapshot taken from `chore/branch-audit-2026-09-25` reset to `origin/main`
(`a642536`, "feat: add shared date helpers (#124)") after fixing a bug in
the audit script's file-comparison step (see "Bug fix" below).

This is a read-only inventory. No branch was deleted or pushed.

## Method

For every local branch (excluding `main` and `worktree-agent-*`):

1. **Commit ancestry:** are all branch-ahead commits already reachable from
   `origin/main`?
2. **Patch-id equivalence:** if a commit's hash is not on `origin/main`
   but the same patch-id is, the branch is considered merged
   (rebase/squash with editorial changes).
3. **File-level overlap:** for the remaining delta, list files where the
   branch tip content differs from `origin/main`, or files added by the
   branch that do not exist on `origin/main`. Files are read with
   `git show <branch>:<path>`, never from the working tree.

## Bug fix

The first version of `scripts/audit-branches.sh` read each file with
`cat "$f"`, which inspects the working tree. When the audit was run from
`origin/main` (the usual case), every branch was reported as having
"matching" source files because the working tree equals the reference.
The script now reads with `git show "<branch>:<path>"` and stores file
paths in a temp file so paths with spaces survive word-splitting.

## Totals

| Category | Count |
|---|---:|
| Local branches reviewed | 80 |
| Obsolete (every commit reachable from `origin/main`) | 10 |
| Merged-equivalent (every commit's patch-id matches a `origin/main` commit) | 54 |
| Has unique delta (at least one commit with no patch-id match) | 16 |
| `worktree-agent-*` (transient agent scratch, excluded from audit) | 6 |

The 16 "has unique delta" rows include the in-progress audit branch
itself (`chore/branch-audit-2026-09-25`) and the cherry-picked scenario
matrix branch (`test/pr-review-scenario-matrix`); 14 are pre-existing
remote-tracking or local branches.

## Obsolete — already merged into `origin/main`

`git log origin/main..<branch>` is empty (branch tip is on main), **or**
every branch-ahead commit's `git patch-id` matches a commit reachable
from `origin/main`. Safe to delete.

### Direct-ancestry (no commits ahead of `origin/main`)

- `chore/daily-audit-2026-09-13`
- `feat/friendly-newton-57013f`
- `feat/incremental-review-dedupe`
- `feat/loop-tick-audit`
- `feat/loop-tick3-audit`
- `feat/loop-tick4-audit`
- `feat/machine-readable-review-report`
- `feat/peaceful-bassi-87f907`
- `feat/v2-phase0-contract` — last commit 2026-01-03, 106 commits behind.
  Pure historical noise predating V3 and the `v2/` flatten (PR #79).
- `fix/zero-thread-and-empty-answer-guard`

### Merged-equivalent (patch-id matched, content rewritten on `main`)

- `chore/daily-audit-2026-09-14` (1 equiv)
- `docs/english-research-and-agent-rule` (1 equiv)
- `docs/v2-cca-patterns` (1 equiv)
- `feat/loop-tick5` … `feat/loop-tick27` (23 branches, 1 equiv each)
- `feat/pi-skills` (1 equiv)
- `feat/review-hardening-and-research` (1 equiv)
- `feat/rich-summary-decision` (1 equiv)
- `feat/skip-draft-prs` (1 equiv)
- `feat/suggestion-consolidation` (1 equiv)
- `feat/summary-file-counts` (1 equiv)
- `feat/v2-audit-phase-1-blockers` (1 equiv)
- `feat/v2-audit-phase-3-polish` (1 equiv)
- `feat/v2-claude-action-01-detector` … `feat/v2-claude-action-10-binary-path` (10 branches, 1 equiv each)
- `feat/v2-claude-action-align` (1 equiv)
- `feat/verify-pass-wiring` (1 equiv)
- `fix/audit-lifecycle-integrity` (1 equiv)
- `fix/auto-approve-error-log` (1 equiv)
- `fix/graphql-bot-login-attribution` (1 equiv)
- `fix/pr-content-model-compat` (1 equiv)
- `fix/v2-delegate-cwd` (1 equiv)
- `fix/v2-entry-pr-review` (1 equiv)
- `fix/v2-pi-runtime` (1 equiv)
- `verify/approval-fix` (1 equiv)

## Has unique delta vs `origin/main` (16 branches)

Columns are: source files matching main / differing / added by branch /
deleted by branch (files listed in branch commits but absent at tip).
These branches have at least one commit whose `git patch-id` does not
appear on `origin/main`. The classification groups branches by what the
delta actually looks like at the branch tip.

### Source merged but tip differs (refactor divergence on `main`)

The branch was merged, but `origin/main` has since refactored the same
source files, so the file content at the branch tip no longer matches
the reference. Re- the branches are not literally merged byte-for-byte
on `origin/main`, but the intent is already shipped and re-implementing
them would conflict with current work.

| Branch | same | diff | add | del | Note |
|---|---:|---:|---:|---:|---|
| `feat/cloudflare-audit-inspired-improvements` | 13 | 5 | 0 | 0 | 4 commits, scope matches PR #115 (`d8dac18`) which is on `origin/main`. The 5 differing files are the same source refactored on main. |
| `feat/review-usage-report` | 7 | 13 | 0 | 0 | 2 commits; the 13 differing files (harness, pi, report, reviewer, tests, v1 contract) are the same surface refactored across PR #116 and later on `origin/main`. |
| `fix/semgrep-completion-truth` | 14 | 5 | 0 | 0 | 3 commits; semantics shipped, docs files were rewritten on main since. |
| `fix/approval-with-workflow-token` | 0 | 6 | 0 | 0 | 1 commit (PR #123). Source on `origin/main` has the same `resolveApproval` logic at a different location, plus PR #124 (zero-thread guard) and PR #126 (bot attribution) refactors on top. |

### Real, unmerged delta worth reviewing

| Branch | same | diff | add | del | Note |
|---|---:|---:|---:|---:|---|
| `feat/test-v2-skills` | 0 | 1 | 1 | 0 | Adds `examples/v2-skills-test/Component.jsx` (a React fixture with intentional issues for Pi to catch). Diff is `.github/workflows/pr-review.yml` — likely a small CI tweak. |
| `test/customer-compat` | 0 | 2 | 3 | 0 | Adds `examples/customer-test/sample.js`. The 2 src files added (`pr-content/src/{contentUpdater,index}.ts`) and the workflow diff are from the old `pr-content/src/` layout (pre-flatten). |
| `test/v2-auto-approve` | 0 | 1 | 1 | 0 | Adds `examples/clean-test/clean.js` plus a `.github/workflows/pr-review.yml` tweak. |
| `test/v2-delegation` | 0 | 1 | 1 | 0 | Adds `examples/customer-test/sample.js` plus a `.github/workflows/pr-review.yml` tweak. |
| `feat/e2e-reply-test` | 0 | 0 | 3 | 0 | Adds reply-target fixtures + a reply E2E scenario that lives in the obsolete `v2/tests/e2e/` tree. Re-authoring needed. |
| `fix/review-execution-visibility` | 0 | 9 | 1 | 0 | 8 work-in-progress commits. The 9 differing source files are largely absorbed by PR #118 / #123 / #124 / #126 on `origin/main`. The 1 added file, `tests/e2e/pr-scenarios.test.ts`, is a 241-line scenario matrix that does not exist on `origin/main` and was cherry-picked separately as `test/pr-review-scenario-matrix`. |

### Likely stale — predates the `v2/` flatten (PR #79)

These branches add files under `v2/src/`, `v2/tests/`, `v2/dist/` that
were deleted when the repo was flattened. They will not apply cleanly
to the current tree without manual rework.

| Branch | same | diff | add | del | Note |
|---|---:|---:|---:|---:|---|
| `fix/summary-template-rules` | 0 | 2 | 24 | 0 | Adds `pr-content/src/*`, `v2/dist/*`, `v2/src/*`, `v2/tests/github/*` — all from the pre-flatten tree. |
| `feat/v2-delegate-pr-content` | 0 | 1 | 13 | 0 | Adds `pr-content/src/__tests__/*`, `pr-content/src/index.ts`, `pr-content/src/v2Delegate.ts`, `v2/dist/*`, `v2/src/*`, `v2/tests/*`. |
| `feat/v2-audit-phase-2-hardening` | 0 | 2 | 26 | 0 | Adds `docs/audit-phase-2-spec.md`, `docs/v2-architecture.md`, `pr-content/.github/workflows/example.yml`, `v2/src/*`, `v2/tests/*`; one commit is `WIP: phase-2 hardening progress`. |
| `claude/autonomous-product-loop` | 0 | 0 | 4 | 0 | Adds `docs/plan/AUTONOMOUS-PRODUCT-LOOP.md`, `v2/src/cli.ts`, `v2/src/review/reviewer.ts`, `v2/tests/review/reviewer.test.ts`. |

### This audit itself

| Branch | same | diff | add | del | Note |
|---|---:|---:|---:|---:|---|
| `chore/branch-audit-2026-09-25` | 0 | 1 | 2 | 0 | Adds `docs/research/audit-branches-2026-09-25.md` and `scripts/audit-branches.sh`; updates `docs/index.md`. |
| `test/pr-review-scenario-matrix` | 0 | 0 | 1 | 0 | Adds `tests/e2e/pr-scenarios.test.ts` cherry-picked from `fix/review-execution-visibility` (commit `7f953ff`), with two assertions adjusted to the V3 summary format. |

## Recommended cleanup

1. The **64 obsolete** branches (10 direct + 54 merged-equivalent) can
   be deleted locally. Remote deletion must be done explicitly via
   `git push origin --delete <branch>`; this audit does not push.
2. The **4 "source merged but tip differs"** branches are not
   shippable as-is — the same ideas are already on `origin/main`, just
   refactored. Deleting is the right call.
3. The **6 "real delta"** branches mostly add test fixtures
   (`examples/*`) and one workflow tweak. Decide per-branch whether
   to keep the fixture on the current tree or drop the branch.
4. The **4 "predates flatten"** branches are stale. Close without
   merge; re-author any feature you actually want on top of the
   current tree.

## Remote-only branches (no local tracking branch)

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
- The "source merged but tip differs" group is inferred from file
  comparisons; the actual logic on the branch tip is plausibly already
  on `origin/main` under a different shape, but this audit does not
  read every line to confirm equivalence.
- "Real, unmerged delta" entries add new files but I did not inspect
  every new file in detail; some may be empty or low-value.
- `scripts/audit-branches.sh` reproduces this report against any
  reference (default `origin/main`).