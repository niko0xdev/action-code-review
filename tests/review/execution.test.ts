import { describe, expect, it } from 'vitest';
import {
	RAW_HARNESS_SUMMARY_MAX_CHARS,
	buildRawHarnessSection,
	describeReviewExecution,
	incompleteReviewFailure,
	rawHarnessDumpEnabled,
} from '../../src/review/execution.js';
import type { ReviewResult } from '../../src/types/finding.js';

function result(overrides: Partial<ReviewResult> = {}): ReviewResult {
	return {
		findings: [],
		summary: '',
		risk: 'none',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: ['a.ts', 'b.ts'],
		...overrides,
	};
}

describe('describeReviewExecution', () => {
	it('reports a complete run when every file was analyzed', () => {
		const execution = describeReviewExecution({
			result: result({ reviewStatus: 'complete' }),
			filesSelected: 2,
		});
		expect(execution.complete).toBe(true);
		expect(execution.filesNotAnalyzed).toBe(0);
	});

	it('counts files missing from the reviewed list', () => {
		const execution = describeReviewExecution({
			result: result({ reviewStatus: 'complete' }),
			filesSelected: 5,
		});
		expect(execution.complete).toBe(false);
		expect(execution.filesNotAnalyzed).toBe(3);
	});

	it('trusts the larger of reported and computed gaps', () => {
		const execution = describeReviewExecution({
			result: result({
				reviewStatus: 'incomplete',
				diagnostics: { failedGroups: 1, filesNotAnalyzed: 9 },
			}),
			filesSelected: 5,
		});
		expect(execution.filesNotAnalyzed).toBe(9);
		expect(execution.failedGroups).toBe(1);
	});

	it('treats a failed group as incomplete even at full file count', () => {
		const execution = describeReviewExecution({
			result: result({
				reviewStatus: 'complete',
				diagnostics: { failedGroups: 1 },
			}),
			filesSelected: 2,
		});
		expect(execution.complete).toBe(false);
	});
});

describe('incompleteReviewFailure', () => {
	it('returns null for a complete review with no findings', () => {
		expect(
			incompleteReviewFailure({
				result: result({ reviewStatus: 'complete' }),
				filesSelected: 2,
			})
		).toBeNull();
	});

	it('explains a crashed harness group', () => {
		const message = incompleteReviewFailure({
			result: result({
				reviewStatus: 'incomplete',
				filesReviewed: ['a.ts', 'b.ts', 'c.ts'],
				diagnostics: { failedGroups: 1, filesNotAnalyzed: 7 },
			}),
			filesSelected: 10,
		});
		expect(message).toContain('Review incomplete');
		expect(message).toContain('1 review group(s) failed');
		expect(message).toContain('7 of 10 selected file(s) were not analyzed');
		expect(message).toContain('No approval was submitted');
	});

	it('flags a stale review', () => {
		const message = incompleteReviewFailure({
			result: result({ reviewStatus: 'stale', filesReviewed: [] }),
			filesSelected: 3,
		});
		expect(message).toContain('status stale');
	});
});

describe('rawHarnessDumpEnabled', () => {
	it('is off by default', () => {
		expect(rawHarnessDumpEnabled({})).toBeNull();
	});

	it('accepts boolean-ish and byte budgets', () => {
		expect(rawHarnessDumpEnabled({ AI_REVIEW_DEBUG_HARNESS: 'true' })).toBe(
			RAW_HARNESS_SUMMARY_MAX_CHARS
		);
		expect(rawHarnessDumpEnabled({ AI_REVIEW_DEBUG_HARNESS: '1' })).toBe(
			RAW_HARNESS_SUMMARY_MAX_CHARS
		);
		expect(rawHarnessDumpEnabled({ AI_REVIEW_DEBUG_HARNESS: '4096' })).toBe(
			4096
		);
	});

	it('ignores junk and caps absurd budgets', () => {
		expect(rawHarnessDumpEnabled({ AI_REVIEW_DEBUG_HARNESS: 'no' })).toBeNull();
		expect(rawHarnessDumpEnabled({ AI_REVIEW_DEBUG_HARNESS: '0' })).toBeNull();
		expect(
			rawHarnessDumpEnabled({ AI_REVIEW_DEBUG_HARNESS: '999999999' })
		).toBe(5 * 1024 * 1024);
	});
});

describe('buildRawHarnessSection', () => {
	it('returns null without runs or output', () => {
		expect(buildRawHarnessSection([], 1000)).toBeNull();
		expect(
			buildRawHarnessSection([{ stdout: '  ', stderr: '' }], 1000)
		).toBeNull();
	});

	it('redacts secrets and neutralizes fence escapes', () => {
		const section = buildRawHarnessSection(
			[
				{
					stdout:
						'line ``` fence\nAuthorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123',
					stderr: '',
				},
			],
			10_000
		);
		expect(section).toContain('\\`\\`\\`');
		expect(section).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
		expect(section?.split('</details>').length).toBe(2);
	});

	it('truncates past the budget and says so', () => {
		const section = buildRawHarnessSection(
			[{ stdout: 'x'.repeat(5000), stderr: '' }],
			100
		);
		expect(section).toContain('truncated');
		expect(section).toContain('4900 of 5000 chars omitted');
	});

	it('labels multiple runs', () => {
		const section = buildRawHarnessSection(
			[
				{ stdout: 'first', stderr: '' },
				{ stdout: 'second', stderr: 'err' },
			],
			10_000
		);
		expect(section).toContain('--- run 1/2 ---');
		expect(section).toContain('--- run 2/2 ---');
		expect(section).toContain('[stderr]');
	});
});
