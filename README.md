# Action Code Review

Repository-aware PR reviews from a coding harness over any
OpenAI-compatible endpoint. `pr-review` posts inline findings + summary;
`pr-content` refreshes PR title/description. Both ship as thin composite
actions (`action.yml` + self-contained `dist/index.js`) built from `src/`.

## Quick start

```yaml
name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
      - name: Run AI Code Review
        uses: niko0xdev/action-code-review/pr-review@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          # openai-base-url: https://api.openai.com/v1
          # openai-model: gpt-4o
          # review-prompt: Focus on security vulns and missing tests.
          # max-files: 10
          # exclude-patterns: '*.md,*.json,*.lock'
```

Pin `uses:` to a released tag once published (example `@v1`).
Full input list: [`pr-review/action.yml`](pr-review/action.yml),
[`pr-content/action.yml`](pr-content/action.yml). Frozen behavior:
[`docs/v1-interface-contract.md`](docs/v1-interface-contract.md).

## What it does

- Reviews the whole repo (callers, tests, related files), not just the diff.
- Stack profiles (React/NextJS, NestJS/NodeJS, Python, Swift, Kotlin, SQL)
  plus curated security skills pick review rules per PR.
- `mode: security` with `diff|lite|balanced|deep|confirm` profiles,
  static scanners, and SARIF output.
- Validated findings only (path in PR, line touched, confidence gate),
  one-click suggestions for small fixes, approve/request-changes decision.

More: [`docs/index.md`](docs/index.md).

## Local development

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm lint
pnpm build   # emits pr-review/dist/index.js + pr-content/dist/index.js
```

Engine lives in `src/`; contract tests (`tests/contract.test.ts`) fail on
any frozen input/output drift. The repo reviews its own PRs
(`.github/workflows/pr-review.yml`).

## License

[MIT](pr-review/LICENSE).
