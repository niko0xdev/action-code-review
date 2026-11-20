# V1 Interface Contract (Immutable)

> This document is the frozen compatibility contract for the legacy
> `pr-content` and `pr-review` actions. The engine keeps every item below
> working. Any change to these surfaces requires an explicit alias that
> preserves the old interface. Contract tests in
> `tests/contract.test.ts` (+ `tests/runtime-install.test.ts`,
> `tests/action-runtime.test.ts`) enforce this mechanically.
>
> Snapshot taken from `main` at commit `4374c63`
> (refactor: improve code formatting and add window resize listener, PR #9),
> before the engine rewrite.

---

## Entry points

| Path | Action name | Description |
|------|-------------|-------------|
| `niko0xdev/action-code-review/pr-content@<ref>` | Auto-update PR Content | Auto-update PR title and description using AI based on code changes |
| `niko0xdev/action-code-review/pr-review@<ref>` | AI Code Review | Uses an OpenAI-compatible endpoint to review pull requests and suggest improvements |

Runner: both actions originally declared `runs.using: node20`,
`runs.main: dist/index.js`. They now ship as **composite actions** that
install their own coding-agent runtime (pinned, idempotent) and then run
the same `dist/index.js`. This is an internal packaging change only —
every input, output, default and env-var name in this document remains
exactly as listed; consumer workflows are unaffected.

---

## `pr-content/action.yml`

### Inputs

| Input | Required | Default |
|-------|----------|---------|
| `github-token` | **true** | — |
| `openai-api-key` | **true** | — |
| `openai-base-url` | false | — (no default) |
| `openai-model` | false | `'gpt-4'` |
| `max-tokens` | false | `'1000'` |
| `include-file-list` | false | `'true'` |
| `custom-instructions` | false | `''` |
| `template-path` | false | `'.github/pull_request_template.md'` |

### Outputs

None declared.

### Behavior contract

- Only runs on `pull_request` events; otherwise calls `core.setFailed('This action can only be run on pull requests')`.
- Fetches PR details, changed files (`pulls.listFiles`) and optionally reads
  the template file at `template-path` (failure tolerated → empty template).
- Sends system + user prompt to the OpenAI Chat Completions API with
  `temperature: 0.3`, `max_tokens` from input.
- Expects a JSON response with `title` and `description`; falls back to
  extracting the first `{...}` block from prose.
- Updates the PR via `pulls.update`. Skips the API call when nothing changed.
- Template handling: if the AI description contains `## Description` it is used
  verbatim; otherwise template placeholders are filled.

### Environment variables (additive, not inputs)

| Variable | Default | Meaning |
|----------|---------|---------|
| `AI_PR_CONTENT_DIAGRAM` | unset (off) | `'true'` asks the same model call for a Mermaid `sequenceDiagram` and appends it under `### Change flow (generated)` once it passes the safe line grammar (at most 30 lines and 2,000 characters; no HTML, directives, backticks, or URLs) and secret redaction; an invalid diagram is omitted with a log line, never failing the run |

This is deliberately **not** an action input: the input list above is frozen.
Set it in the job or step `env:` block. When it is unset or any value other
than `'true'`, the prompt and the published description are byte-identical to
the behaviour without it.

---

## `pr-review/action.yml`

### Inputs

| Input | Required | Default |
|-------|----------|---------|
| `github-token` | **true** | — |
| `openai-api-key` | **true** | — |
| `openai-base-url` | false | — (no default) |
| `openai-model` | false | `'gpt-4'` |
| `review-prompt` | false | `'Focus on correctness, code quality, security, performance, test coverage, and best practices. Provide actionable, line-specific feedback whenever possible.'` |
| `max-files` | false | `'10'` |
| `exclude-patterns` | false | `'*.md,*.txt'` |
| `include-dir` | false | — (no default) |
| `auto-approve-when-resolved` | false | `'false'` |
| `min-severity` | false | `'critical'` |
| `block-on-issues` | false | `'true'` |
| `include-full-content` | false | `'false'` |
| `max-context-chars` | false | `'30000'` |

Additive input (not part of the frozen V1 surface; added after V1, optional, default preserves existing behaviour):

| Input | Required | Default |
|-------|----------|---------|
| `review-effort` | false | `'auto'` |
| `linked-issue` | false | `'false'` |
| `scorecard-context` | false | `'false'` |
| `check-run` | false | `'false'` |
| `security-skills` | false | `'all'` |
| `repository-instructions` | false | `'false'` |
| `secret-scan` | false | `'false'` |
| `fix-prompts` | false | `'false'` |

`review-effort` accepts `auto`, `lite`, `balanced`, or `deep`. `auto` selects
`lite` only for a complete file list with at most three files after filtering,
no classifier risk domain, no change to the file selection, and no enabled
Scorecard context, automatic security-skill selection, prelint, or verify pass.
Otherwise it selects `balanced`, the existing behaviour. `auto` never widens
the scope or drops enabled optional work. Explicit `lite` caps review at three
files (largest changes first, subject to lower caps), skips those optional
steps, and retains the standard security skills and any enabled secret scan.
`deep` ignores the `max-files` input, keeps all other budgets including the
`AI_REVIEW_MAX_FILES` ceiling and `max-context-chars`. Verification remains
opt-in via `AI_REVIEW_VERIFY_PASS=true` and caps patch evidence at the smaller
of `max-context-chars` and 24,000 characters. Changing the preset can change
the review decision: `deep` can surface findings in more files, and `lite`
prevents auto-approval when its cap leaves paths unreviewed.
Invalid effort values warn and fall back to `balanced`, as do non-positive file
caps. The effective preset is visible in the summary and in
`review-report.diagnostics.reviewEffort`.
`linked-issue` (default `'false'`) reads GitHub's GraphQL closing references when the review analyses selected files. It assesses up to three same-repository issues from the first three references in a separate, tool-free call to the configured provider, using capped issue text and selected patches. The PR summary and optional `review-report.linkedIssues` array show the issue number, title, verdict, and reasoning. Assessments never create findings, block a pull request, or affect auto-approval. If the query fails, including for insufficient token permissions, the action warns and omits the assessment.

`scorecard-context` is opt-in. When `'true'` and the repository is public, the
review fetches the repository's published OSSF Scorecard once from
`api.securityscorecards.dev` and gives the reviewer a fixed-format table of numeric
scores as advisory context. Failures never fail or block a review.

`repository-instructions` is opt-in. When `'true'`, the review rules also
include `AGENTS.md`, `.github/copilot-instructions.md`, and every
`.github/instructions/*.instructions.md` (at most 20) whose `applyTo` front-matter
globs match a changed path. Only the copies at the pull request base commit are
read (local git objects first, the contents API for shallow checkouts); without a
base commit nothing is read. Each file keeps the 50 KiB cap, the total is capped
at 64 KiB, each file is fenced, and the paths used are reported in
`review-report` as `diagnostics.repositoryInstructions`.

`check-run` is opt-in. When `'true'`, the action creates one completed check run
named `AI Code Review` on the reviewed head commit, so teams can require it in
branch protection. It is created after the review itself and before the summary
comment, so a failure to post the summary cannot leave it unreported. Its
conclusion mirrors the review decision exactly: `failure` when the review
submitted `REQUEST_CHANGES` (a blocking finding, `block-on-issues` `'true'`, and
write permission), `neutral` when only non-blocking findings exist, `success`
when there are no findings, and, for an incomplete review (the step's own rule,
which also counts selected files that were not analysed), `failure`, or
`neutral` when `AI_REVIEW_FAIL_ON_INCOMPLETE=false` because the step then only
warns. The title follows the conclusion. A run that reviews nothing still
reports a completed, neutral check with a `Skipped:` title, so a required check
is never left unreported: a draft, an empty file selection, a head that moved
during the review, and a head that could not be rechecked each produce one. All
of them, the moved head included, go on the reviewed head, never on a newer
one: a late neutral check there would replace the newer run's check of the same
name, a failing one included. Each finding becomes an annotation (`failure` for
critical and high, `warning` for medium, `notice` for low) with a redacted,
length-capped title and message; the first 50 go with the create request and the
rest follow in `checks.update` batches of 50. The output summary is compact
Markdown capped at 20,000 characters, and every model-supplied value in it is
redacted before it is escaped, so a quoted credential cannot survive as an HTML
entity. The workflow needs `checks: write`; any Checks API error (403, 404, 422,
or other) only logs a warning, worded by what the status means, and never fails,
blocks, or changes the review. When the check was created but a later
annotation batch failed, the warning says the annotations were partially
published. A pull request from a fork has a read-only token and cannot create a
check (warning only), so the check is reported as missing on fork pull requests.
include the root `AGENTS.md`, `.github/copilot-instructions.md`, and the
`.github/instructions/*.instructions.md` files whose `applyTo` front-matter globs
match a changed path (at most 20 matching files, from the first 200 listed).
`applyTo` may be a string, comma-separated or quoted strings, an inline `[...]`
list, or a YAML block list; globs support `**`, `*`, `?`, and one level of
`{a,b}`, a leading `./` or `/` is ignored, and a glob with more than two `**`
segments is skipped with a warning, as is a file whose `applyTo` yields no glob.
A file with `excludeAgent: "code-review"` is skipped, fixed files included, and
the value is compared exactly. A quoted glob inside a comment is not a rule,
and a glob with more than eight wildcards or more than 200 characters is
skipped with a warning, so matching cannot blow up. Only the copies at the pull
request base commit are read (local git objects first, the contents API for
shallow checkouts), and a symlink is ignored on both paths; without a base commit
nothing is read. Identical texts are used once, each file keeps the 50 KiB cap,
the total is capped at 64 KiB, each file is fenced, and the paths used are
reported in `review-report` as `diagnostics.repositoryInstructions`. Nested
`AGENTS.md` files are not read.

`check-run` is opt-in. When `'true'`, after the review is published (never when
publishing is skipped because the head moved) the action creates one completed
check run named `AI Code Review` on the reviewed head commit, so teams can require
it in branch protection. Its conclusion mirrors the review decision: `failure`
when a blocking finding exists and `block-on-issues` is `'true'`, or when the
review is incomplete or failed; `neutral` when only non-blocking findings exist;
`success` when there are no findings. Each finding becomes an annotation
`check-run` is opt-in. When `'true'`, after the review is published the action
creates one completed check run named `AI Code Review` on the reviewed head
commit, so teams can require it in branch protection. Its conclusion mirrors
the review decision exactly: `failure` when the review submitted
`REQUEST_CHANGES` (a blocking finding, `block-on-issues` `'true'`, and write
permission), `neutral` when only non-blocking findings exist, `success` when
there are no findings, and `neutral` for an incomplete review when
`AI_REVIEW_FAIL_ON_INCOMPLETE=false` (the step only warns in that case, so the
check must not fail the branch). A run that reviews nothing still reports a
completed, neutral check, so a required check is never left unreported: a draft,
an empty file selection, and a head that moved during the review each produce
one with a `Skipped:` title, the last on the head that is current. Each finding becomes an annotation
(`failure` for critical and high, `warning` for medium, `notice` for low) with a
redacted, length-capped title and message; the first 50 go with the create
request and the rest follow in `checks.update` batches of 50. The output summary
is compact Markdown capped at 20,000 characters, and every model-supplied value
in it is redacted before it is escaped, so a quoted credential cannot survive
as an HTML entity. The workflow needs `checks: write`; any Checks API error
(403, 404, 422, or other) only logs a warning, worded by what the status means,
and never fails, blocks, or changes the review. A pull request from a fork has a
read-only token and cannot create a check, so the check is reported as missing
on fork pull requests.
`secret-scan` is opt-in. When `'true'`, the deterministic secret scanner used by
`mode: security` runs over the added lines of every changed file with a patch,
independent of `exclude-patterns`, after the main review and any verify pass.
Each match becomes a `security` finding (critical or high, confidence 1, rule id
`secret-scan/<rule>`) that names the credential type but never quotes the value;
a published match replaces a model `security` finding on its line, keeping the
higher of the two severities, so a model finding cannot hide a credential. At
most ten matches are added per run, counts and risk are recomputed, and the
number added is reported as `diagnostics.secretScanFindings`. Secret findings are
added after the `min-severity` filter, so a high-severity match (a Slack token)
is published and blocks even with the default `min-severity: critical`. The scan
also runs when the file filters leave nothing for the model to review: a
docs-only pull request with a credential is still published and blocked. That
path publishes the report and the job summary as well, and it publishes even
when nothing matched, so a block from an earlier secret-only run is withdrawn
once the credential is gone. The published AWS documentation key ids and
kebab-case `sk-` names are not reported, and an added line containing
`secret-scan: allow` or `pragma: allowlist secret` skips a match in normal
reviews and in `mode: security` alike, but only when the matched value cannot
be a real credential (it names an example, repeats a character, or repeats a
short block). The marker sits on a line the pull request author controls, so it
never silences a plausible credential. A private key header without key
material is not reported either.

`fix-prompts` is opt-in. When `'true'`, each inline finding comment gets a
collapsed `<details>` block, "Prompt for your coding agent", placed before the
hidden `ai-review-id` marker. It restates the path, line, title, problem,
impact, and suggested fix for pasting into a coding agent. The text is model
output, so it is redacted, links (scheme URLs, `javascript:` and similar
schemes, `www.` hosts, and bare `host.tld/path` text) are replaced with
`[link removed]` on a best-effort basis, the path and title are kept on one line
with control and hidden characters escaped (Unicode tag characters included),
HTML comment delimiters are broken up so the text cannot carry a comment marker,
each field is capped at 2,000 characters, it opens by telling the agent to treat
it as a report rather than commands, and it is fenced so it cannot close the
block. The marker and the finding identity are unchanged, and the publisher reads
the last marker in a comment, so duplicate suppression keeps working.

`incremental-review` is opt-in. When `'true'`, the action keeps a ledger of the
findings of the last run in the sticky summary comment, as a base64 payload in
the hidden marker `ai-review-ledger`. On the next run it asks GitHub which files
changed since the head the ledger was produced from, and re-reviews only those
files plus the files that still carry open findings. The summary then reports how
many findings are new, still open, fixed, and regressed, and `review-report`
carries the same counts under `ledger`. A finding is recognised across runs by
its path, its category, and its rule (the rule identifier the model supplies,
or the first words of its title), so a reworded finding or one that moved to
another line is the same finding. A force-push, an unknown commit, or a failed
comparison falls back to a full review, and a finding whose file was not
reviewed again stays open rather than being reported as fixed.

`security-skills` is a new optional input (additive; the default `'all'` leaves
the review prompt byte-identical). `'auto'` keeps only the curated security skills
for risk domains the existing classifier flags in the changed files, always keeps
the validation gate, and uses all skills when it cannot classify.

### Outputs

| Output | Description |
|--------|-------------|
| `review-summary` | e.g. `"12 files reviewed, 3 issues found"`, or `"skipped: no files to review"` when filters leave nothing to review. Additive: when the review is incomplete (crashed group, unanalysed files, or a truncated file list) the string ends with ` (review incomplete)`, e.g. `"12 files reviewed, 3 issues found (review incomplete)"`. Consumers must not parse the string; use `review-report` for machine-readable status |
| `review-report` | Additive machine-readable JSON report (see below) |

#### `review-report` (additive)

Emitted after a normal PR review completes. Not part of the frozen V1 surface —
it was added additively and may be extended; `schemaVersion` bumps only on a
breaking shape change.

```jsonc
{
  "schemaVersion": 1,
  "status": "complete",           // complete | incomplete | failed | stale
  "risk": "low",
  "counts": { "critical": 0, "high": 0, "medium": 1, "low": 0 },
  "coverage": {
    "filesReviewed": 4,
    "filesTotal": 6,
    "filesExcluded": 2,
    "filesTruncated": false,
    "fileDetailsTruncated": false,
    "filesOmitted": 0,
    "files": [
      { "path": "src/app.ts", "status": "reviewed" },
      { "path": "docs/guide.md", "status": "excluded", "reason": "configured-filter" }
    ]
  },
  "findings": [ /* validated, capped findings */ ],
  "usage": {
    "status": "complete",         // complete | partial
    "inputTokens": 1200,
    "outputTokens": 340,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0,
    "totalTokens": 1540,
    "assistantMessages": 3,
    "toolCallsStarted": 12,
    "durationMs": 84000,
    "processes": { "started": 2, "succeeded": 2, "failed": 0 }
  },
  "diagnostics": { /* pipeline diagnostics, when present */ },
  "ruleCoverage": { /* rule-level coverage, when present */ },
  "approval": { "state": "approved", "detail": "..." }  // when considered
}
```

- `approval.state` records what really happened to the automatic approval
  review: `approved` only when GitHub accepted it, `not-permitted` when
  repository settings refused it, `failed` for any other API error,
  `skipped-unresolved-threads`, `skipped-no-write-permission`, or
  `not-requested`. `detail` is a redacted, single-line reason. The PR summary
  comment renders the same state, so a clean review is never presented as an
  approval GitHub rejected.

- `status` is derived conservatively: `failedGroups > 0` forces `incomplete`,
  the builder reports `incomplete` whenever the result carries `filesTruncated`
  (`coverage.filesTruncated: true`), even if the producer declared `complete`, and an unknown status is reported as `incomplete` rather than
  assumed clean. An incomplete review never approves, shows the incomplete
  banner in the sticky summary, and fails the step unless
  `AI_REVIEW_FAIL_ON_INCOMPLETE=false`.
  `failed` is reserved and accepted defensively, but the current pipeline never
  emits it (failed groups are reported as `incomplete`).
- `coverage.filesTotal` counts the PR files returned by the listing before any
  filtering. When the listing safety cap is hit, `filesTruncated` is `true` and
  `filesTotal` may be below the actual PR file count.
- `coverage.filesExcluded` is `filesTotal` minus the files that survived
  filtering, so it bundles every reason a file was not reviewed: exclude
  patterns, a missing patch, and the `max-files` cap. On an incomplete review,
  `filesReviewed + filesExcluded` can be less than `filesTotal`: files in a
  failed review group are counted as neither reviewed nor excluded.
- `coverage.files` is an additive per-file ledger for the collected PR file
  list. `status` is `reviewed`, `excluded`, or `not-analyzed`. Excluded entries
  use one reason: `configured-filter`, `missing-patch`, `default-ignore`, or
  `max-files`. A selected but unreviewed file uses `review-group-failed` when
  any review group failed, otherwise `review-incomplete` (this includes files
  cut off or omitted because the diff exceeded `max-context-chars`; truncation
  happens per file at hunk boundaries). Entries contain only the
  repository-relative path and status/reason, never the patch or file
  contents. Existing string redaction also applies to these paths. The ledger
  is capped at 128 Ki UTF-16 characters; `fileDetailsTruncated` and
  `filesOmitted` report any entries omitted at that limit. This is separate
  from `filesTruncated`, which means GitHub pagination hit its safety cap. The
  field is empty only when a caller builds a report without the pipeline's file
  ledger; the action's normal review path supplies the collected list, subject
  to the detail-size cap.
- `usage` is always present and **additive**. Its counters are
  **provider-reported** values aggregated from the harness's JSON event stream:
  `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheWriteTokens`/`totalTokens`
  are summed only from completed assistant `message_end` events (never from
  cumulative `message_update` snapshots), `assistantMessages` counts those
  completed messages, `toolCallsStarted` counts `tool_execution_start` events,
  and `processes` tallies the harness subprocesses (`started`/`succeeded`/
  `failed`). Malformed events, malformed usage shapes, and non-finite or
  negative counters are ignored or clamped to `0`, so a bad producer cannot
  poison the totals.
- `usage.status` is `partial` whenever any harness process failed **or** the
  review itself is not `complete`; otherwise it is `complete`. A failed process
  retains any usage and tool starts it emitted before exiting.
- `usage.durationMs` is the wall-clock span from the earliest started harness
  process to the latest process exit — not the sum of concurrent process
  durations — and is `0` when no process started.
- These counters are **not a billing ledger**. An in-flight provider request
  that is killed may never emit a final usage event, so an interrupted run can
  under-report; custom OpenAI-compatible providers may report zero or no
  counters at all. No USD estimate is derived from them.
- Content is limited to the validated/capped review result plus numeric usage:
  no prompts, raw model traces, stdout/stderr, tokens, credentials, or full PR
  source.
- Every string value is pattern-redacted (`redactSecrets`) on a serialized
  copy; the engine result is not mutated. Redaction is pattern-based and is not
  a general secret detector.
- The output is empty whenever no review result exists: the action is skipped,
  runs in security mode, or errors during or before the review. An empty value
  means "no report", not "no findings".
- The report describes the **analysis** result, so emission is **attempted**
  even if publishing to GitHub fails: the report is built after publication
  settles, so a publish failure does not discard it. This is best effort, not a
  guarantee — if building or writing the report also fails, the publish error
  stays primary and no report is emitted. The action still fails as it did
  before.
- Content is limited to the validated/capped review result: no prompts, raw
  model traces, tokens, credentials, or full PR source.

### Environment variables honored by consumers

Consumers configure models through secrets mapped into inputs:

```text
OPENAI_API_KEY   → openai-api-key
OPENAI_API_URL   → openai-base-url
OPENAI_API_MODEL → openai-model
```

The engine continues to accept all three names as configuration sources.

### Severity model

Legacy severities and their rank in `filterCommentsBySeverity`:

```text
low      = 0
high     = 1
critical = 2   ← min-severity default ('critical'), unknown values also resolve to 2
```

Inline comment bodies embed `_Severity:_ <level>` which the filter parses;
comments without a recognized severity marker are dropped when filtering.

### Comment identity / duplicate suppression

Each inline comment body ends with a hidden marker:

```html
<!-- ai-review-id:<12 hex chars> -->
```

The id is a SHA-256 prefix over `path|line|body|ruleId`. Before posting,
existing review comments from the authenticated bot login are scanned and
matching ids are skipped.

### Behavior contract

- Only runs on `pull_request` events; otherwise `core.setFailed('This action only runs on pull requests')`.
- Lists PR files, applies `exclude-patterns` (comma-separated glob-ish,
  `*` → `.*`), optional `include-dir` allowlist, then truncates to `max-files`.
- Empty file list after filtering → `review-summary` is `skipped: no files to review` and the run exits green. It is logged as a notice, or as a warning when an `include-dir` or non-default `exclude-patterns` removed every file. `include-dir` entries drop a leading `/`; entries containing `..` match nothing and warn.
- Reviews each file via OpenAI Chat Completions (`temperature: 0.3`,
  `max_tokens: 1500`). Response is parsed as strict JSON
  (`file_overview`, `summary_points`, `positive_insights`, `risks`,
  `inline_comments[] { line, title, comment, recommendation, severity }`)
  with fallback to `Line N:` text parsing.
- Comments filtered by `min-severity`.
- Posting: one `pulls.createReview` per file with event
  `REQUEST_CHANGES` when `block-on-issues=true` and issues exist, else
  `COMMENT`; on failure falls back to individual `createReviewComment`
  calls, then to issue comments (`## 📝 Review for <file>`).
- Always posts a PR issue-comment summary when files were reviewed:

  ```markdown
  # 🤖 AI Code Review

  **Reviewed files:** N
  **Total issues found:** M
  ```

- Sets output `review-summary`.
- When `auto-approve-when-resolved` is enabled (default `false`): paginates
  GitHub's GraphQL `reviewThreads` connection. A thread is treated as
  AI-authored only when its root comment carries the action's hidden marker and
  its author matches the token's login, or, when the login cannot be resolved (a
  workflow `GITHUB_TOKEN` is refused on `GET /user`), is a bot account. GraphQL
  reports bot logins without the `[bot]` suffix (`github-actions`), so they are
  normalised to the REST form (`github-actions[bot]`) before matching.
  Approval also requires a complete review, at least one AI-authored thread,
  no findings dropped by `min-severity`, no finding whose unknown category was
  bucketed to `low`, and every changed file kept by the configured filters
  reviewed (a file cut by `max-files`, without a patch from GitHub, or under a
  default-ignored path such as `dist/` or a lockfile blocks approval unless
  `exclude-patterns` lists it); a PR with no AI threads is never approved. If every AI-authored thread is resolved, submits an `APPROVE` review with body
  `All AI-generated review comments have been resolved. Auto-approving PR.`
  Missing or malformed thread data fails closed and never triggers approval.
  GitHub refuses `APPROVE` from `GITHUB_TOKEN` unless the repository enables
  "Allow GitHub Actions to create and approve pull requests"; that refusal is
  reported as `approval.state = not-permitted` in the summary and the report
  instead of being silently swallowed. `REQUEST_CHANGES` reviews are unaffected
  by that setting. The summary claims `APPROVED` only from an accepted approval.

### Failure modes

- Any thrown error → `core.setFailed('Action failed: <error>')` (non-zero exit).
- LLM/API errors while reviewing one file are swallowed per-file
  (logged, no comments from that file); the action continues.
- A review that did not cover its whole scope (a harness group crashed, a file
  was never analyzed, or the status is stale/incomplete) fails the step with
  `Review incomplete (…)` so a crashed harness can no longer look like a clean
  green run. `AI_REVIEW_FAIL_ON_INCOMPLETE=false` downgrades it to a warning.

### Exit codes

GitHub Actions convention: `0` success (including "no findings"),
`1` failure via `core.setFailed` — including an incomplete review, unless
`AI_REVIEW_FAIL_ON_INCOMPLETE=false`.

---

## Permissions expected by callers

```yaml
permissions:
  contents: read
  pull-requests: write
```

The actions must not require more than this by default. The opt-in `check-run`
input additionally needs `checks: write`. Submitting an `APPROVE` review
additionally requires the repository setting "Allow GitHub Actions to create and
approve pull requests" (`can_approve_pull_request_reviews`); without it GitHub
answers HTTP 422 and the action reports it as `approval.state = not-permitted`.
`REQUEST_CHANGES` works with the permissions block alone.

---

## Trigger events

Consumer workflows trigger on:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

The actions keep supporting exactly these events plus manual re-runs.

---

## What may change vs. what may not

| Surface | Status |
|---------|--------|
| Action paths (`pr-content`, `pr-review`) | **Frozen** |
| Input names & defaults above | **Frozen** |
| Output `review-summary` | **Frozen** |
| Env var names `OPENAI_API_KEY` / `OPENAI_API_URL` / `OPENAI_API_MODEL` | **Frozen** |
| `<!-- ai-review-id:... -->` marker format | **Frozen** (duplicate suppression depends on it) |
| Summary comment format | May be extended (new sections allowed), must stay recognizable |
| Internal implementation | Free |

New inputs/outputs may be added; existing ones may not be removed or renamed.

---

## Internal-only environment variables (not public interface)

The following variables are consumed by the engine internals. They are
**not** action inputs and not part of the frozen contract; external
callers may set them in a workflow `env:` block, but no consumer is
required to know about them and their names may change:

| Variable | Meaning | Default |
|----------|---------|---------|
| `INPUT_REPLY_TO_COMMENT_ID` | GitHub numeric review comment id to post an inline reply beneath | unset (reply disabled) |
| `INPUT_REPLY_BODY` | Body of that inline reply | unset |

Both must be set together for a reply to post; otherwise the reply step
is skipped silently.

## Audit completion and source-evidence additions (18/11/2026)

The additive `review-report` output may include `contextCoverage` with `suppliedPaths` and `omittedPaths`. A supplied path means its complete patch fitted in the prompt, not that a tool inspected it. Partial or absent patches remain omitted even if a truncation marker cannot fit. Omitted mandatory context makes the assessment incomplete and prevents approval.

`diagnostics.verifyVerdicts`, when present, records candidate `id`, `verdict` (`supported`, `refuted`, `uncertain`, or `error`), `reason`, and `evidenceIds`. Source evidence is drawn from the same base/head patches. Only a complete source-backed refutation removes a candidate; malformed or uncertain verification retains findings and makes the review incomplete. These fields are additive and retain schema version 1.

Security failure thresholds use every validated occurrence before publication filters and caps. The publisher only trusts its own markers. More precise security identity can produce a one-off new comment after upgrading from the older fingerprint algorithm. Auto-approval remains opt-in.

The existing `security_conclusion` JSON output may include an additive `refutations` array for explicit confirmation rejections. Each entry contains pattern-redacted `id`, `fingerprint`, `title`, optional `file`/`startLine`, and `reason`. It is absent when no complete explicit refutation was committed. Audit reports render the same ledger; publication filters and invalid confirmation batches do not manufacture refutations.
