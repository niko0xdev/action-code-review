# Review Prompts

This file contains example prompts that can be used to customize the AI code review. You can reference these prompts in your workflow by using the `review-prompt` input with the path to this file.

## Example Prompts

### Security Focus
```
Focus specifically on security vulnerabilities, authentication issues, input validation, and potential injection attacks.
```

### Performance Focus
```
Focus on performance bottlenecks, inefficient algorithms, memory leaks, and optimization opportunities.
```

### Code Quality Focus
```
Focus on code readability, maintainability, design patterns, and adherence to coding standards.
```

### Testing Focus
```
Focus on test coverage, edge cases, and potential bugs in the implementation.
```

### Best Practices Focus
```
Focus on industry best practices, documentation, error handling, and architectural considerations.
```

## Usage in Workflow

To use a custom prompt from this file in your workflow:

```yaml
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
    # Read custom prompt from file
    - name: Load Review Prompt
      id: load-prompt
      run: |
        CUSTOM_PROMPT=$(cat path/to/review-prompt.md)
        echo "custom_prompt=$CUSTOM_PROMPT" >> $GITHUB_ENV
        
    - name: Run AI Code Review
      if: env.custom_prompt != ''
        uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-base-url: ${{ inputs.openai-base-url }}
          openai-model: ${{ inputs.openai-model }}
          review-prompt: ${{ env.custom_prompt }}
          max-files: ${{ inputs.max-files }}
          exclude-patterns: ${{ inputs.exclude-patterns }}
```
