# PR Content Auto-Update Action

This GitHub Action automatically updates pull request titles and descriptions using AI based on code changes. It can optionally use a pull request template to format the description.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | Yes | - |
| `openai-api-key` | OpenAI API key for generating content | Yes | - |
| `openai-base-url` | Custom OpenAI API base URL (optional) | No | - |
| `openai-model` | OpenAI model to use | No | `gpt-4` |
| `max-tokens` | Maximum tokens for AI response; retries after a truncated or unparseable answer double it, up to 32768 | No | `1000` |
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
      - uses: actions/checkout@v5
      - name: Update PR Content
        uses: niko0xdev/action-code-review/pr-content@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

### Using a Custom OpenAI Base URL

```yaml
name: Update PR Content
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  update-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Update PR Content
        uses: niko0xdev/action-code-review/pr-content@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-base-url: ${{ secrets.OPENAI_BASE_URL }}
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
      - uses: actions/checkout@v5
      - name: Update PR Content
        uses: niko0xdev/action-code-review/pr-content@main
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
      - uses: actions/checkout@v5
      - name: Update PR Content
        uses: niko0xdev/action-code-review/pr-content@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          custom-instructions: "Focus on security implications and performance improvements"
```

### Adding a Sequence Diagram (opt-in)

Set `AI_PR_CONTENT_DIAGRAM: 'true'` in the job or step `env:` (it is an
environment variable, not an input). The same model call also returns a short
Mermaid `sequenceDiagram` of the main changed flow, which is appended to the
description under `### Change flow (generated)`.

```yaml
      - name: Update PR Content
        uses: niko0xdev/action-code-review/pr-content@main
        env:
          AI_PR_CONTENT_DIAGRAM: 'true'
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

The diagram is untrusted model output. It is published only when it passes a
strict line grammar (participant or actor declarations, `->>`, `-->>`, `->`, and
`-->` messages with optional `+`/`-` activation suffixes, `Note over|left of|right of`,
`alt`/`else`/`opt`/`loop`/`end` blocks, and `autonumber`), with at most 30 lines
and 2,000 characters, and no HTML, entities, comments, `click`, `link`, or
`%%{init}` directives, backticks, semicolons, or URLs. A deactivation (`-`) must
follow a matching activation (`+`), as Mermaid requires. Participant names with
dots or hyphens, or that match a Mermaid keyword in any case, are rewritten to
aliases with the original name as the label, and `#` is written as the entity
`#35;` because Mermaid otherwise reads it as a comment. Anything else is dropped
with a log line naming the diagram line and the reason, and the run continues. Secrets are redacted as in the rest of the description. The diagram
adds output tokens, so consider raising `max-tokens` when it is enabled.

## How It Works

1. The action fetches the pull request details and file changes
2. If a template file is specified, it reads the template from the repository
3. It sends the code changes and template to the OpenAI-compatible endpoint for analysis
4. The model generates an improved title and description based on the changes
5. If a template is provided, the action fills in the template with the AI-generated content
6. The action updates the pull request with the new title and description

## Template Format

The template should be a valid Markdown file with placeholders that the AI will fill in. The action looks for specific comments to identify where to insert content:

- `<!-- AI will fill this section with a description of what changed -->` - Replaced with the main description
- `<!-- AI will fill this section with testing information -->` - Replaced with testing information if provided by the AI

The AI will preserve the template structure and formatting, only filling in the content sections.

## Development

`dist/index.js` is built from the engine — all logic lives in `src/`:

```bash
pnpm install
pnpm build   # emits pr-review/dist/index.js + pr-content/dist/index.js
```

Tests are run using Vitest, a modern test framework for TypeScript/JavaScript projects.
