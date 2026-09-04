import { describe, expect, it } from 'vitest';
import {
	buildUserPrompt,
	createSystemPrompt,
} from '../../../src/llm/prompts/pr-content.js';

describe('pr-content prompts', () => {
	it('includes template and custom instructions', () => {
		const prompt = createSystemPrompt(
			'Keep concise',
			'## Description\n<!-- fill -->'
		);
		expect(prompt).toContain('Keep concise');
		expect(prompt).toContain('## Description');
		expect(prompt).toContain('title');
	});

	it('includes PR title, body, diffs, and optional file list', () => {
		const prompt = buildUserPrompt(
			'Old title',
			'Old body',
			[{ filename: 'src/a.ts', status: 'modified', patch: '+new code' }],
			true
		);
		expect(prompt).toContain('Old title');
		expect(prompt).toContain('Old body');
		expect(prompt).toContain('modified: src/a.ts');
		expect(prompt).toContain('+new code');
	});
});
