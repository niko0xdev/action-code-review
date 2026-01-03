# AI PR Comment Reply

A GitHub Action that automatically replies to developer questions on PR review comments with AI assistance. When developers ask questions in reply to AI-generated review comments, this action detects the question and provides a helpful AI-powered response.

## Use Case

When the AI code review action posts comments with change requests, developers might have questions like:
- "Why should I use async/await here?"
- "Can you explain this security concern?"
- "What do you mean by 'race condition'?"

This action detects such questions and provides helpful AI-powered explanations directly in the comment thread.

## Inputs

| Input | Required | Default | Description |
|-------|----------|----------|-------------|
| `github-token` | Yes | - | GitHub token for API access (usually `secrets.GITHUB_TOKEN`) |
| `openai-api-key` | Yes | - | OpenAI API key for generating replies |
| `openai-base-url` | No | - | Custom OpenAI API base URL (optional) |
| `openai-model` | No | `gpt-4` | OpenAI model to use for replies |
| `reply-prompt` | No | Built-in prompt | Custom prompt for AI replies |
| `enable-question-detection` | No | `true` | If true, only reply to comments that appear to be questions |
| `include-full-content` | No | `false` | Include full source code content in AI context (better context, higher cost) |
| `max-context-chars` | No | `10000` | Maximum character limit for file content context |

## Outputs

| Output | Description |
|--------|-------------|
| `reply-generated` | Whether a reply was generated (`true` or `false`) |

## Usage

### Basic Setup

Add the following to your repository's `.github/workflows/pr-comment.yml`:

```yaml
name: AI PR Comment Reply

on:
  issue_comment:
    types: [created, edited]
  workflow_dispatch:

jobs:
  reply:
    runs-on: ubuntu-latest
    name: AI Comment Reply

    permissions:
      contents: read
      pull-requests: write
      issues: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run AI Comment Reply
        uses: ./pr-comment
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-base-url: ${{ secrets.OPENAI_API_URL }}
          openai-model: ${{ secrets.OPENAI_API_MODEL }}
```

### Required Secrets

Configure these secrets in your GitHub repository settings:

- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_API_URL` (optional): Custom OpenAI API base URL
- `OPENAI_API_MODEL` (optional): Model to use (default: `gpt-4`)

## How It Works

1. **Trigger**: Action triggers when a new comment is created or edited on a PR
2. **Filtering**: Checks if the comment:
   - Is from a human (not a bot)
   - Is not an AI reply itself (avoids infinite loops)
   - Appears to be a question (optional detection)
3. **Context Building**: Gathers context including:
   - The original AI review comment
   - The developer's question
   - Relevant file and code context
4. **AI Response**: Generates a helpful reply using OpenAI
5. **Posting**: Replies directly to the comment thread

## Features

- **Smart Question Detection**: Only responds to actual questions (configurable)
- **Context-Aware**: Includes relevant code and file context in responses
- **Loop Prevention**: Automatically detects and avoids replying to its own comments
- **Retry Logic**: Automatically retries failed API calls with exponential backoff
- **Fallback**: Falls back to issue comment if thread reply fails

## Tech Stack

- **pnpm**: Package manager
- **vitest**: Testing framework
- **biomejs**: Linting and formatting
- **TypeScript**: Type-safe development

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Build for production
pnpm build
```

## License

MIT

