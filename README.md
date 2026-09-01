# Action Code Review

Open-source monorepo that powers the **AI Code Review GitHub Action** and ships with example apps that show how to adopt it. Use it to add automated, AI-assisted pull request reviews to any repository, then extend it for your own workflows.

## What's Inside

```
.
├── pr-review/          # Source for the reusable GitHub Action
├── pr-content/         # Companion action: auto-updates PR title/description
├── v2/                 # V2 engine: repository-aware review via a coding harness
├── examples/nextjs/    # Sample Next.js app wired to the action
├── docs/               # Design spec, V1 interface contract, V2 architecture
└── .github/workflows/  # Prompt samples and internal workflows
```

- `pr-review` is the published GitHub Action (`niko0xdev/action-code-review/pr-review`) that analyzes pull requests, summarizes findings, and leaves inline comments. It now transparently delegates to the **V2 engine** when present in the checkout — same inputs, same outputs (see `docs/v1-interface-contract.md`).
- `v2/` is the next-generation engine: a coding agent inspects the whole repository (callers, tests, related files) instead of reviewing diffs in isolation, over any OpenAI-compatible endpoint. See `docs/v2-architecture.md`.
- `examples/nextjs` shows how a typical web app can include the action in its CI pipeline.
- `.github/workflows/review-instruction.md` contains ready-made prompt snippets you can reuse with the `review-prompt` input.

## Key Features

- **AI-powered reviews** – Uses OpenAI (GPT-4 by default) to inspect diffs for correctness, security, performance, and style issues.
- **Security Review & Audit Profiles** – Dedicated security diff review and repository audit modes (`mode: security`) with curated AppSec skills, static scanners (Semgrep, secrets, dependencies), false-positive gating, and SARIF output.
- **Line-specific comments** – Publishes review threads directly on the affected lines so teams can address feedback quickly.
- **Review summaries** – Leaves a human-readable overview of the PR health plus machine-readable outputs for further automation.
- **Configurable scope** – Limit the number of files, exclude paths, or inject your own prompts to tailor what the model inspects.
- **Auto-approval option** – Let the bot approve once all of the issues it opened have been resolved.

## V2 & Security Engine

V2 replaces the engine, not the interface: consumer workflows stay untouched while reviews become repository-aware. Highlights:

- **Coding-harness review** – a coding agent inspects callers, interfaces and tests before judging a change, not just the raw diff.
- **Security review profiles** – `diff`, `lite`, `balanced`, `deep`, `confirm` modes for fast PR diff scanning or deep scheduled repository security audits.
- **Any OpenAI-compatible endpoint** – OpenAI, LiteLLM, vLLM, zrouter or any gateway speaking chat/completions; configured through the existing `OPENAI_API_*` variables.
- **Stack profiles & Cybersecurity skills** – deterministic detection plus tailored review rules for React/NextJS, NestJS/NodeJS, Python/uv, Swift/iOS and Kotlin/Android, plus curated cybersecurity skills.
- **Validated findings & SARIF** – every candidate is checked (path in the PR? line touched? confidence ≥ 0.8?) before publishing; duplicates are suppressed; SARIF v2.1.0 report generated automatically.
- **Suggested changes** – small high-confidence fixes render as one-click GitHub suggestions.

See `docs/security-review.md`, `docs/security-model.md`, `docs/v2-design-spec.md`, `docs/v1-interface-contract.md`, `docs/v2-architecture.md` and [`CHANGELOG-V2.md`](CHANGELOG-V2.md).

## Quick Start

1. **Create secrets**
   - `OPENAI_API_KEY` – OpenAI access token.
   - (Optional) custom base URL or model inputs if you proxy requests.
2. **Drop the workflow**

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Run AI Code Review
        uses: niko0xdev/action-code-review/pr-review@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          # Optional inputs:
          # openai-base-url: https://api.openai.com/v1
          # openai-model: gpt-4o
          # review-prompt: |
          #   Focus on security vulns and missing tests.
          # max-files: 10
          # exclude-patterns: '*.md,*.json,*.lock'
          # auto-approve-when-resolved: false
```

Pin the `uses:` value to a released tag once you publish one (for example, `@v1`). Until then, `@main` keeps your workflows using the latest open-source code in this repo.

### Replying to Existing Review Threads

The action can post an inline reply beneath an existing review comment — handy for follow-up explanations without opening a new thread. Set two environment variables on the review step and the engine posts a reply-only comment (no summary, no re-review):

```yaml
      - name: Run AI Code Review
        uses: niko0xdev/action-code-review/pr-review@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
        env:
          INPUT_REPLY_TO_COMMENT_ID: '1234567890'   # GitHub review comment id
          INPUT_REPLY_BODY: 'Follow-up: tenantId now comes from the request context.'
```

Omit both variables (the default) and behavior is unchanged. Replies reuse the same hidden `ai-review-id` marker as inline findings, so duplicate suppression keeps working across threads.

### Custom Prompts

Use `.github/workflows/review-instruction.md` for pre-written prompt snippets. You can load them inside a workflow step and pass the text to the `review-prompt` input:

```yaml
- name: Load prompt
  id: prompt
  run: |
    PROMPT_CONTENT=$(cat .github/workflows/review-instruction.md)
    echo "prompt<<'EOF'" >> $GITHUB_OUTPUT
    echo "$PROMPT_CONTENT" >> $GITHUB_OUTPUT
    echo "EOF" >> $GITHUB_OUTPUT

- name: AI Review (custom prompt)
  uses: niko0xdev/action-code-review/pr-review@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    review-prompt: ${{ steps.prompt.outputs.prompt }}
```

## Local Development

1. **Install dependencies**

   ```bash
   cd pr-review   # legacy action
   pnpm install

   cd ../v2       # V2 engine
   pnpm install
   ```

2. **Build, lint, and test**

   ```bash
   # in v2/
   pnpm test        # full suite (unit + contract + e2e)
   pnpm typecheck
   pnpm lint
   pnpm build       # tsc → dist/

   # in pr-review/
   pnpm run build
   npx vitest run
   ```

3. **Iterate on the engine** – Engine changes live under `v2/src`; the contract tests in `v2/tests/contract.test.ts` fail if any legacy input/output/default drifts. Iterate on the legacy action via `pr-review/src/index.ts`.

## Example Next.js App

The sample under `examples/nextjs` lets you see the action end-to-end inside a simple web app.

```bash
cd examples/nextjs
pnpm install
pnpm dev
```

Once the dev server runs on `http://localhost:3000`, open a PR against that project and watch the AI review run with the same workflow snippet shown above.

## Contributing

This project is open source under the MIT License. Issues and pull requests are welcome:

1. Fork the repository and create a feature branch.
2. Make changes inside the relevant package (`pr-review` or an `examples/*` project).
3. Add or update tests plus formatting (`pnpm run lint:fix && pnpm run format` inside `pr-review`).
4. Run the test suite (`pnpm run test`) and ensure workflows stay green.
5. Open a pull request describing the enhancement or fix.

## License

Released under the [MIT License](pr-review/LICENSE). Use it in your own pipelines, remix it for self-hosted LLMs, or contribute improvements back to the community.
