import { describe, expect, it } from 'vitest';
import type { ReviewHarness } from '../../src/harness/harness.js';
import { planReviewGroups } from '../../src/review/planner.js';
import { runReview } from '../../src/review/reviewer.js';
import type { ReviewContext } from '../../src/types/context.js';
import type { ReviewResult } from '../../src/types/finding.js';

function makeContext(files: string[]): ReviewContext {
	return {
		repository: { owner: 'acme', repo: 'widget' },
		pullRequest: {
			number: 3,
			title: 'T',
			body: '',
			author: 'a',
			headRef: 'h',
			baseRef: 'main',
			headSha: 's1',
			baseSha: 's0',
			draft: false,
		},
		diff: {
			files: files.map((filename) => ({
				filename,
				status: 'modified' as const,
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -1 +1,2 @@\n a\n+b',
			})),
			totalAdditions: files.length,
			totalDeletions: 0,
		},
		profiles: [{ id: 'nodejs', evidence: ['package.json'] }],
		repositoryPath: '/repo',
	};
}

describe('planReviewGroups', () => {
	it('returns a single group for small PRs', () => {
		const groups = planReviewGroups(makeContext(['a.ts', 'b.ts']), 10);
		expect(groups).toHaveLength(1);
		expect(groups[0].files).toEqual(['a.ts', 'b.ts']);
	});

	it('partitions large PRs into area-based groups', () => {
		const files = Array.from({ length: 30 }, (_, i) => `src/api/r${i}.ts`);
		files.push('src/components/Widget.tsx', 'tests/app.test.ts');
		const groups = planReviewGroups(makeContext(files), 10);
		expect(groups.length).toBeGreaterThan(1);
		const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
		expect(totalFiles).toBe(32);
	});
});

describe('runReview', () => {
	it('limits concurrent group reviews to three', async () => {
		let active = 0;
		let maximum = 0;
		const harness: ReviewHarness = {
			name: 'slow',
			async review(): Promise<ReviewResult> {
				active += 1;
				maximum = Math.max(maximum, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return {
					findings: [],
					summary: '',
					risk: 'none',
					counts: { critical: 0, high: 0, medium: 0, low: 0 },
					filesReviewed: [],
				};
			},
		};
		await runReview(
			makeContext(Array.from({ length: 10 }, (_, i) => `f${i}.ts`)),
			harness,
			{ maxFilesPerGroup: 1 }
		);
		expect(maximum).toBe(3);
	});

	it('preserves successful group order after a failure', async () => {
		const harness: ReviewHarness = {
			name: 'ordered',
			async review(context): Promise<ReviewResult> {
				if (context.diff.files[0].filename === 'f1.ts')
					throw new Error('failed');
				return {
					findings: [],
					summary: context.diff.files[0].filename,
					risk: 'none',
					counts: { critical: 0, high: 0, medium: 0, low: 0 },
					filesReviewed: [],
				};
			},
		};
		const result = await runReview(
			makeContext(['f0.ts', 'f1.ts', 'f2.ts']),
			harness,
			{ maxFilesPerGroup: 1 }
		);
		expect(result.summary).toBe('f0.ts\n\nf2.ts');
	});

	it('aggregates findings from every group and dedupes', async () => {
		let call = 0;
		const harness: ReviewHarness = {
			name: 'fake',
			async review(): Promise<ReviewResult> {
				call += 1;
				return {
					findings: [
						{
							severity: 'high',
							confidence: 0.9,
							category: 'correctness',
							path: 'a.ts', // same anchor from every group
							line: 2, // the +b line in makeContext's patch
							title: 'Same issue seen twice',
							description: 'd',
							impact: 'i',
						},
					],
					summary: `summary ${call}`,
					risk: 'high',
					counts: { critical: 0, high: 1, medium: 0, low: 0 },
					filesReviewed: [],
				};
			},
		};
		const context = makeContext(['a.ts', 'b.ts', 'c.ts']);
		const result = await runReview(context, harness, { maxFilesPerGroup: 1 });

		expect(call).toBe(3); // one group per file at maxFilesPerGroup=1
		expect(result.findings.filter((f) => f.path === 'a.ts')).toHaveLength(1);
	});

	it('validates findings against changed lines before publishing', async () => {
		const harness: ReviewHarness = {
			name: 'fake',
			async review(): Promise<ReviewResult> {
				return {
					findings: [
						{
							severity: 'critical',
							confidence: 0.95,
							category: 'security',
							path: 'a.ts',
							line: 999, // not in the patch
							title: 'Bad anchor',
							description: 'd',
							impact: 'i',
						},
						{
							severity: 'medium',
							confidence: 0.85,
							category: 'maintainability',
							path: 'a.ts',
							line: 2, // the +b addition line
							title: 'Good anchor',
							description: 'd',
							impact: 'i',
						},
					],
					summary: '',
					risk: 'medium',
					counts: { critical: 1, high: 0, medium: 1, low: 0 },
					filesReviewed: [],
				};
			},
		};
		const result = await runReview(makeContext(['a.ts']), harness);
		expect(result.findings.map((f) => f.title)).toEqual(['Good anchor']);
	});

	it('caps findings from each harness result before aggregation', async () => {
		const findings = Array.from({ length: 10_000 }, (_, index) => ({
			severity: 'low' as const,
			confidence: 0.9,
			category: 'correctness' as const,
			path: 'a.ts',
			line: 2,
			title: `finding ${index}`,
			description: 'd',
			impact: 'i',
		}));
		const harness: ReviewHarness = {
			name: 'large',
			async review(): Promise<ReviewResult> {
				return {
					findings,
					summary: '',
					risk: 'low',
					counts: { critical: 0, high: 0, medium: 0, low: findings.length },
					filesReviewed: [],
				};
			},
		};
		const result = await runReview(makeContext(['a.ts']), harness);
		expect(result.findings.length).toBeLessThanOrEqual(20);
	});

	it('propagates harness failures with diagnostics', async () => {
		const harness: ReviewHarness = {
			name: 'fake',
			async review(): Promise<ReviewResult> {
				throw new Error('LLM endpoint returned 502');
			},
		};
		const result = await runReview(makeContext(['a.ts']), harness);
		expect(result.findings).toEqual([]);
		expect(result.filesReviewed).toEqual([]);
		expect(result.diagnostics?.failedGroups).toBeGreaterThan(0);
	});
});
