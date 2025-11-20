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
        uses: actions/checkout@v4
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
| `auto-approve-when-resolved` | Approve the pull request once all AI-created review threads are resolved | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `review-summary` | Summary of the code review |

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

## Development

### Building the Action

```bash
# Install dependencies
npm install

# Build the action
npm run build

# Run tests
npm run test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

### Project Structure

```
.
├── src/
│   └── index.ts          # Main action code
├── dist/                 # Built action (generated)
├── __tests__/
│   └── index.test.ts     # Test file
├── .github/
│   └── workflows/
│       └── pr-review.yml # Example workflow
├── action.yml            # Action metadata
├── biome.json            # Biome configuration
├── vitest.config.ts      # Vitest configuration
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
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
