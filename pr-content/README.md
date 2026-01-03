# AI-Powered PR Content Updater

Automatically update pull request titles and descriptions using AI. Analyzes code changes and generates clear, focused PR content. Supports custom templates for consistent formatting.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | - |
| `openai-api-key` | OpenAI API key for generating content | Yes | - |
| `openai-base-url` | Custom OpenAI API base URL (optional) | No | - |
| `openai-model` | OpenAI model to use | No | `gpt-4` |
| `max-tokens` | Maximum tokens for AI response | No | `1000` |
| `include-file-list` | Whether to include list of changed files in description | No | `true` |
| `custom-instructions` | Additional instructions for content generation | No | `''` |
| `template-path` | Path to pull request template file in the repository | No | `.github/pull_request_template.md` |

## Usage

### Quick Start

```yaml
name: Update PR Content
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  update-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Update PR Content
        uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

### With Custom Template

Create `.github/pull_request_template.md`:

```markdown
## Description
<!-- AI will fill this section -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Checklist
- [ ] My code follows the style guidelines
- [ ] I have performed a self-review
- [ ] Tests pass locally with my changes
```

Then reference it in your workflow:

```yaml
- name: Update PR Content
  uses: ./
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    template-path: '.github/pull_request_template.md'
```

### Advanced Options

**Custom OpenAI endpoint:**
```yaml
openai-base-url: ${{ secrets.OPENAI_BASE_URL }}
```

**Custom instructions for AI:**
```yaml
custom-instructions: "Focus on security and performance"
```

## How It Works

1. Fetches PR details and code changes
2. Sends changes to OpenAI for analysis
3. AI generates optimized title and description
4. Updates PR with new content (fills templates if provided)

## Template Format

Use Markdown comments to mark where AI should insert content:

- `<!-- AI will fill this section -->` - Replaced with generated description

The AI preserves your template structure and only fills marked sections.

## Development

To build the action:

```bash
npm run build
```

To run tests:

```bash
npm test
```

To lint the code:

```bash
npm run lint
```

Tests are run using Vitest, a modern test framework for TypeScript/JavaScript projects.
