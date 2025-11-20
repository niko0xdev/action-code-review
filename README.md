# Action Code Review

Open-source monorepo that powers the **AI Code Review GitHub Action** and ships with example apps that show how to adopt it. Use it to add automated, AI-assisted pull request reviews to any repository, then extend it for your own workflows.

## What's Inside

```
.
├── pr-review/          # Source for the reusable GitHub Action
├── examples/nextjs/    # Sample Next.js app wired to the action
└── .github/workflows/  # Prompt samples and internal workflows
```

- `pr-review` is the published GitHub Action (`niko0xdev/action-code-review/pr-review`) that calls OpenAI to analyze pull requests, summarize findings, and leave inline comments.
- `examples/nextjs` shows how a typical web app can include the action in its CI pipeline.
- `.github/workflows/review-instruction.md` contains ready-made prompt snippets you can reuse with the `review-prompt` input.

## Key Features

- **AI-powered reviews** – Uses OpenAI (GPT-4 by default) to inspect diffs for correctness, security, performance, and style issues.
- **Line-specific comments** – Publishes review threads directly on the affected lines so teams can address feedback quickly.
- **Review summaries** – Leaves a human-readable overview of the PR health plus machine-readable outputs for further automation.
- **Configurable scope** – Limit the number of files, exclude paths, or inject your own prompts to tailor what the model inspects.
- **Auto-approval option** – Let the bot approve once all of the issues it opened have been resolved.

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
   cd pr-review
   pnpm install
   ```

2. **Build, lint, and test**

   ```bash
   pnpm run build
   pnpm run lint
   pnpm run test
   ```

3. **Iterate on the action** – Update `src/index.ts`, rebuild with `pnpm run build`, and commit the generated `dist` output so GitHub Actions can execute it.

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
