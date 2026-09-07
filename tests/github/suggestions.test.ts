import { describe, expect, it } from 'vitest';
import { buildSuggestion } from '../../src/github/suggestions.js';
import type { Finding } from '../../src/types/finding.js';

function finding(overrides?: Partial<Finding>): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		path: 'src/a.ts',
		line: 10,
		title: 'Missing tenant filter',
		description: 'The query retrieves the user only by ID.',
		impact: 'Cross-tenant read possible.',
		suggestion: 'Add tenantId to the where clause.',
		replacement: null,
		...overrides,
	};
}

describe('buildSuggestion', () => {
	it('renders a fenced suggestion block for small replacements', () => {
		const block = buildSuggestion(
			finding({ replacement: 'findOne({ id, tenantId })' })
		);
		expect(block).toContain('```suggestion');
		expect(block).toContain('findOne({ id, tenantId })');
	});

	it('returns undefined for large replacements', () => {
		const big = finding({
			replacement: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
		});
		expect(buildSuggestion(big)).toBeUndefined();
	});

	it('returns undefined when no replacement exists', () => {
		expect(buildSuggestion(finding())).toBeUndefined();
	});

	it('returns undefined for whitespace-only replacements', () => {
		expect(buildSuggestion(finding({ replacement: '  \n  ' }))).toBeUndefined();
	});

	it('returns undefined below the 0.85 confidence floor', () => {
		expect(
			buildSuggestion(
				finding({ replacement: 'findOne({ id, tenantId })', confidence: 0.84 })
			)
		).toBeUndefined();
	});

	it('returns undefined past the 400-char cap', () => {
		expect(
			buildSuggestion(finding({ replacement: `x = '${'y'.repeat(400)}';` }))
		).toBeUndefined();
	});
});
