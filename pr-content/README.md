# PR Content Auto-Update Action

This GitHub Action automatically updates pull request titles and descriptions using AI based on code changes. It can optionally use a pull request template to format the description.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | - |
| `openai-api-key` | OpenAI API key for generating content | Yes | - |
| `model` | OpenAI model to use | No | `gpt-4` |
| `max-tokens` | Maximum tokens for AI response | No | `1000` |
| `include-file-list` | Whether to include list of changed files in description | No | `true` |
| `custom-instructions` | Additional instructions for content generation | No | `''` |
| `template-path` | Path to pull request template file in the repository | No | `.github/pull_request_template.md` |

## Usage

### Basic Usage

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

### Using a Custom Template

1. Create a pull request template file in your repository (e.g., `.github/pull_request_template.md`):

```markdown
## Description
<!-- AI will fill this section with a description of what changed -->

## Type of Change
<!-- Please check the relevant options -->
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## How Has This Been Tested?
<!-- AI will fill this section with testing information -->

## Checklist
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published in downstream modules
```

2. Configure the action to use this template:

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
          template-path: '.github/pull_request_template.md'
```

### Using Custom Instructions

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
          custom-instructions: "Focus on security implications and performance improvements"
```

## How It Works

1. The action fetches the pull request details and file changes
2. If a template file is specified, it reads the template from the repository
3. It sends the code changes and template to OpenAI for analysis
4. OpenAI generates an improved title and description based on the changes
5. If a template is provided, the action fills in the template with the AI-generated content
6. The action updates the pull request with the new title and description

## Template Format

The template should be a valid Markdown file with placeholders that the AI will fill in. The action looks for specific comments to identify where to insert content:

- `<!-- AI will fill this section with a description of what changed -->` - Replaced with the main description
- `<!-- AI will fill this section with testing information -->` - Replaced with testing information if provided by the AI

The AI will preserve the template structure and formatting, only filling in the content sections.

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
