# AI Code Review GitHub Action

A GitHub Action that uses OpenAI to review pull requests and suggest improvements. This action analyzes code changes in PRs and provides automated feedback on code quality, security, performance, and best practices.

## Features

- 🤖 **AI-Powered Review**: Uses OpenAI models (GPT-4 by default) for intelligent code analysis
- 📝 **Line-Specific Comments**: Adds comments directly on relevant lines of code
- 📊 **Review Summary**: Provides an overall summary of the code review
- 🔧 **Configurable**: Customize the review prompt, model, and file filters
- 🚫 **File Filtering**: Exclude specific file patterns from review
- 📦 **Easy Setup**: Simple configuration with GitHub secrets

## Setup

### 1. Add OpenAI API Key to Repository Secrets

1. Go to your repository's Settings > Secrets and variables > Actions
2. Click "New repository secret"
3. Add a secret named `OPENAI_API_KEY` with your OpenAI API key

### Usage

Create a workflow file at `.github/workflows/pr-review.yml`:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    name: AI Code Review
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v5
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Run AI Code Review
        uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-base-url: ${{ inputs.openai-base-url }}
          openai-model: ${{ inputs.openai-model }}
          review-prompt: ${{ inputs.review-prompt }}
          max-files: ${{ inputs.max-files }}
          exclude-patterns: ${{ inputs.exclude-patterns }}
```

## Inputs

| Input | Description | Required | Default |
|------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | - |
| `openai-api-key` | OpenAI API key for code review | Yes | - |
| `openai-base-url` | Custom OpenAI API base URL (optional) | No | - |
| `openai-model` | OpenAI model to use for review | No | `gpt-4` |
| `review-prompt` | Custom prompt for OpenAI review | No | Focus on correctness, code quality, security, performance, test coverage, and best practices. Provide actionable, line-specific feedback whenever possible. |
| `max-files` | Maximum number of files to review | No | `10` |
| `exclude-patterns` | Comma-separated list of file patterns to exclude | No | `*.md,*.txt,*.json,*.yml,*.yaml` |
| `include-dir` | Comma-separated list of directory paths to include in review | No | - |
| `auto-approve-when-resolved` | Approve the pull request once all AI-created review threads are resolved | No | `false` |
| `min-severity` | Minimum severity level for comments (low, high, critical) | No | `critical` |
| `block-on-issues` | Block PR merge when issues at or above min-severity are found | No | `true` |

## Outputs

| Output | Description |
|--------|-------------|
| `review-summary` | Summary of the code review |

## Severity levels

Inline comments can include a severity that highlights the impact of an issue. The action uses a 3-level severity system with the following icons to keep feedback easy to scan:

| Severity | Icon | Meaning |
|----------|------|---------|
| low | ✅ | Minor improvements, style suggestions, best practices |
| high | 🔥 | Significant bugs, performance issues, major code smells |
| critical | 🚨 | Security vulnerabilities, data loss, production breakage |

The default minimum severity is `critical`, which means only critical issues are reported by default. You can adjust this to `high` or `low` to see more issues. Each severity link points back to this table so reviewers understand the impact level at a glance.

## Customization

### Custom Review Prompt

The action now uses a strong system prompt plus a structured reviewer prompt that yields JSON (for summaries and inline comments). The `review-prompt` input is treated as an extra "focus" section inside that structured prompt, so you can still steer the model toward the concerns you care about.

You can customize the review focus to highlight specific aspects:

```yaml
- name: Run AI Code Review
  uses: niko0xdev/action-code-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    review-prompt: |
      Please prioritize:
      1. Security vulnerabilities
      2. Performance bottlenecks
      3. Code maintainability
      4. Adherence to coding standards
      5. Missing tests for risky logic
```

### File Filtering

Exclude specific file patterns from review:

```yaml
- name: Run AI Code Review
  uses: niko0xdev/action-code-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    exclude-patterns: '*.md,*.txt,*.json,*.yml,*.yaml,*.lock,*.test.js,*.spec.ts'
```

Include only specific directories in review:

```yaml
- name: Run AI Code Review
  uses: niko0xdev/action-code-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    include-dir: src,lib  # Only review files in src/ and lib/ directories
```

You can combine `include-dir` with `exclude-patterns` for more precise control:

```yaml
- name: Run AI Code Review
  uses: niko0xdev/action-code-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    include-dir: src
    exclude-patterns: '*.test.ts,*.spec.ts'  # Review src/ but exclude test files
```

### Auto-approve when AI comments are resolved

Enable automatic approval after all AI-generated review threads have been marked as resolved:

```yaml
- name: Run AI Code Review
  uses: niko0xdev/action-code-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    auto-approve-when-resolved: true
```

The action checks review threads authored by the authenticated token and submits an approval review when none of those threads remain unresolved.

### Blocking PR merge on issues

By default, the action will block PR merge when issues at or above the `min-severity` threshold are found. It uses GitHub's `REQUEST_CHANGES` review event, which prevents the PR from being merged until the issues are addressed.

```yaml
- name: Run AI Code Review
  uses: niko0xdev/action-code-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    min-severity: high  # Block on HIGH or CRITICAL issues
    block-on-issues: true  # Enable blocking (default)
```

To disable blocking and only post comments:

```yaml
- name: Run AI Code Review
  uses: niko0xdev/action-code-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    block-on-issues: false  # Don't block merge
```

The blocking behavior works with any `min-severity` setting:
- `min-severity: critical` - Blocks only on CRITICAL issues (default)
- `min-severity: high` - Blocks on HIGH or CRITICAL issues
- `min-severity: low` - Blocks on all issues (LOW, HIGH, CRITICAL)

## Development

`dist/index.js` is built from the engine — all logic lives in `src/`:

```bash
pnpm install
pnpm build   # emits pr-review/dist/index.js + pr-content/dist/index.js
```

### Project Structure

```
.
├── dist/index.js         # Published bundle (generated from src/)
├── action.yml            # Action metadata (frozen consumer interface)
└── README.md             # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run the linter and formatter (`npm run lint:fix` and `npm run format`)
6. Run tests (`npm run test`)
7. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions, please create an issue in the repository.
