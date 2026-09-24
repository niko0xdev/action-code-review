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
| `niko0xdev/action-code-review/pr-review@<ref>` | AI Code Review | Uses OpenAI to review pull requests and suggest improvements |

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
| `exclude-patterns` | false | `'*.md,*.txt,*.json,*.yml,*.yaml'` |
| `include-dir` | false | — (no default) |
| `auto-approve-when-resolved` | false | `'true'` |
| `min-severity` | false | `'critical'` |
| `block-on-issues` | false | `'true'` |
| `include-full-content` | false | `'false'` |
| `max-context-chars` | false | `'30000'` |

### Outputs

| Output | Description |
|--------|-------------|
| `review-summary` | e.g. `"12 files reviewed, 3 issues found"` |
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
  and an unknown status is reported as `incomplete` rather than assumed clean.
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
  any review group failed, otherwise `review-incomplete`. Entries contain only
  the repository-relative path and status/reason, never the patch or file
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
- Empty file list after filtering → exit silently (no summary, no output).
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
- When `auto-approve-when-resolved` is enabled (default `true`): resolves the
  bot login and paginates GitHub's GraphQL `reviewThreads` connection. A thread
  is treated as AI-authored only when its root comment author matches that bot.
  If every AI-authored thread is resolved, submits an `APPROVE` review with body
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

The actions must not require more than this. Submitting an `APPROVE` review
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
