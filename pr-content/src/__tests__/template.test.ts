import { createSystemPrompt } from '../prompts';

describe('Template functionality', () => {
	it('should include template content in system prompt when provided', () => {
		const templateContent = `## Description
<!-- AI will fill this section with a description of what changed -->

## Type of Change
- [ ] Bug fix
- [ ] New feature`;

		const customInstructions = 'Focus on performance improvements';
		const prompt = createSystemPrompt(customInstructions, templateContent);

		expect(prompt).toContain('Use the following pull request template as the base');
		expect(prompt).toContain(templateContent);
		expect(prompt).toContain('Focus on performance improvements');
	});

	it('should work without template content', () => {
		const customInstructions = 'Make it concise';
		const prompt = createSystemPrompt(customInstructions);

		expect(prompt).toContain('Make it concise');
		expect(prompt).not.toContain('Use the following pull request template');
	});
});
