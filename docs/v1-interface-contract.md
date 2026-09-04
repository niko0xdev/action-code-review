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
| `auto-approve-when-resolved` | false | `'false'` |
| `min-severity` | false | `'critical'` |
| `block-on-issues` | false | `'true'` |
| `include-full-content` | false | `'false'` |
| `max-context-chars` | false | `'30000'` |

### Outputs

| Output | Description |
|--------|-------------|
| `review-summary` | e.g. `"12 files reviewed, 3 issues found"` |

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
- When `auto-approve-when-resolved=true`: resolves the bot login, lists
  review threads; if every AI-authored thread is resolved, submits an
  `APPROVE` review with body
  `All AI-generated review comments have been resolved. Auto-approving PR.`

### Failure modes

- Any thrown error → `core.setFailed('Action failed: <error>')` (non-zero exit).
- LLM/API errors while reviewing one file are swallowed per-file
  (logged, no comments from that file); the action continues.

### Exit codes

GitHub Actions convention: `0` success (including "no findings"),
`1` failure via `core.setFailed`.

---

## Permissions expected by callers

```yaml
permissions:
  contents: read
  pull-requests: write
```

The actions must not require more than this.

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
