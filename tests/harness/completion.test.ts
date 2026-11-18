import { describe, expect, it } from 'vitest';
import {
	allocateReviewDiff,
	parseHarnessFindings,
	toReviewResult,
} from '../../src/harness/harness.js';
import type { ChangedFile } from '../../src/types/context.js';

const valid = {
	severity: 'high',
	confidence: 0.9,
	category: 'correctness',
	path: 'a.ts',
	line: 1,
	title: 'Missing guard',
	description: 'The input is unchecked.',
	impact: 'The request can fail.',
};

describe('review completion contract', () => {
	it('rejects a summary-only envelope instead of manufacturing no findings', () => {
		expect(() =>
			parseHarnessFindings('{"summary":"clean","risk":"none"}')
		).toThrow();
	});
	it.each([
		{ findings: [], risk: 'none' },
		{ findings: [], summary: 'clean' },
		{ findings: [], summary: 'clean', risk: 'bogus' },
		{ findings: [null], summary: 'clean', risk: 'none' },
	])('cannot complete an invalid review envelope: %j', (payload) => {
		const output = parseHarnessFindings(JSON.stringify(payload));
		expect(toReviewResult(output, ['a.ts']).reviewStatus).toBe('incomplete');
	});
	it('retains valid candidates when another candidate is malformed', () => {
		const output = parseHarnessFindings(
			JSON.stringify({
				findings: [valid, { severity: 'bogus' }],
				summary: 'partial',
				risk: 'high',
			})
		);
		const result = toReviewResult(output, ['a.ts']);
		expect(result.findings).toEqual([expect.objectContaining(valid)]);
		expect(result.reviewStatus).toBe('incomplete');
	});
	it('completes an explicit empty findings envelope', () => {
		expect(
			toReviewResult(
				parseHarnessFindings('{"findings":[],"summary":"clean","risk":"none"}'),
				['a.ts']
			).reviewStatus
		).toBe('complete');
	});
});

describe('prompt allocation accounting', () => {
	const files: ChangedFile[] = ['a.ts', 'b.ts', 'c.ts'].map((filename) => ({
		filename,
		status: 'modified',
		additions: 1,
		deletions: 1,
		changes: 2,
		patch: '@@ -1 +1 @@\n-old\n+new',
	}));
	it('accounts for paths even when no omission marker fits', () => {
		const allocation = allocateReviewDiff(files, 0);
		expect(allocation.text).toBe('');
		expect(allocation.suppliedPaths).toEqual([]);
		expect(allocation.omittedPaths).toEqual(['a.ts', 'b.ts', 'c.ts']);
	});
	it('does not count a patchless file as supplied source evidence', () => {
		const allocation = allocateReviewDiff(
			[{ ...files[0], patch: undefined }],
			10_000
		);
		expect(allocation.suppliedPaths).toEqual([]);
		expect(allocation.omittedPaths).toEqual(['a.ts']);
	});
	it('partitions full and truncated patches without claiming inspection', () => {
		const allocation = allocateReviewDiff(files, 100);
		expect(allocation.suppliedPaths).toEqual(['a.ts']);
		expect(allocation.omittedPaths).toEqual(['b.ts', 'c.ts']);
		expect(allocation.text).not.toContain('analysed');
	});
});

describe('malformed candidate accounting', () => {
	it.each([
		{ ...valid, confidence: 1.5 },
		{ ...valid, line: 1.5 },
		{ ...valid, description: undefined },
	])(
		'retains useful coercions but never certifies malformed candidates: %j',
		(candidate) => {
			const output = parseHarnessFindings(
				JSON.stringify({ findings: [candidate], summary: '', risk: 'high' })
			);
			expect(toReviewResult(output, ['a.ts']).reviewStatus).toBe('incomplete');
		}
	);
});

it('marks a partly supplied file incomplete even when listed among reviewed files', () => {
	const output = parseHarnessFindings(
		'{"findings":[],"summary":"partial","risk":"none"}'
	);
	const result = toReviewResult(output, ['a.ts'], {
		suppliedPaths: [],
		omittedPaths: ['a.ts'],
	});
	expect(result.filesReviewed).toEqual(['a.ts']);
	expect(result.reviewStatus).toBe('incomplete');
	expect(result.contextCoverage).toEqual({
		suppliedPaths: [],
		omittedPaths: ['a.ts'],
	});
});
