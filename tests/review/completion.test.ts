import { describe, expect, it } from 'vitest';
import { runReview } from '../../src/review/reviewer.js';
import type { ReviewContext } from '../../src/types/context.js';
import type { ReviewResult } from '../../src/types/finding.js';

const context: ReviewContext = {
	repository: { owner: 'a', repo: 'b' },
	repositoryPath: '/repo',
	profiles: [],
	pullRequest: {
		number: 1,
		title: '',
		body: '',
		author: '',
		headRef: 'topic',
		baseRef: 'main',
		headSha: 'head',
		baseSha: 'base',
		draft: false,
	},
	diff: {
		totalAdditions: 1,
		totalDeletions: 1,
		files: [
			{
				filename: 'a.ts',
				status: 'modified',
				additions: 1,
				deletions: 1,
				changes: 2,
				patch: '@@ -1 +1 @@\n-old\n+new',
			},
		],
	},
};
const clean: ReviewResult = {
	findings: [],
	summary: '',
	risk: 'none',
	counts: { critical: 0, high: 0, medium: 0, low: 0 },
	filesReviewed: ['a.ts'],
};

describe('group completion propagation', () => {
	it.each(['incomplete', 'failed', 'stale'] as const)(
		'retains a fulfilled harness %s state as incomplete',
		async (reviewStatus) => {
			const result = await runReview(context, {
				name: 'partial',
				review: async () => ({ ...clean, reviewStatus }),
			});
			expect(result.reviewStatus).toBe('incomplete');
		}
	);
	it('keeps truncated PR listings incomplete even when the harness completes', async () => {
		const result = await runReview(
			{ ...context, diff: { ...context.diff, filesTruncated: true } },
			{ name: 'clean', review: async () => clean }
		);
		expect(result.reviewStatus).toBe('incomplete');
	});
	it('retains prompt supply coverage separately from reviewed files', async () => {
		const result = await runReview(context, {
			name: 'omitted',
			review: async () => ({
				...clean,
				contextCoverage: { suppliedPaths: [], omittedPaths: ['a.ts'] },
			}),
		});
		expect(result.contextCoverage).toEqual({
			suppliedPaths: [],
			omittedPaths: ['a.ts'],
		});
		expect(result.reviewStatus).toBe('incomplete');
	});
});

describe('coverage edge cases', () => {
	it('does not let duplicate or unrelated reviewed paths conceal omitted files', async () => {
		const result = await runReview(context, {
			name: 'invalid-accounting',
			review: async () => ({
				...clean,
				filesReviewed: ['outside.ts', 'outside.ts'],
			}),
		});
		expect(result.filesReviewed).toEqual([]);
		expect(result.reviewStatus).toBe('incomplete');
	});
	it('propagates a truncated listing reported by a fulfilled harness', async () => {
		const result = await runReview(context, {
			name: 'partial-list',
			review: async () => ({ ...clean, filesTruncated: true }),
		});
		expect(result.filesTruncated).toBe(true);
		expect(result.reviewStatus).toBe('incomplete');
	});
});
