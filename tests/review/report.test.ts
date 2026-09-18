import { describe, expect, it } from 'vitest';
import type { ReviewHarness } from '../../src/harness/harness.js';
import {
	buildReviewReport,
	serializeReviewReport,
	withReviewReportOutput,
} from '../../src/review/report.js';
import { runReview } from '../../src/review/reviewer.js';
import type { ReviewContext } from '../../src/types/context.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';

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

function emptyResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
	return {
		findings: [],
		summary: '',
		risk: 'none',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: [],
		reviewStatus: 'complete',
		...overrides,
	};
}

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'correctness',
		path: 'src/a.ts',
		line: 12,
		title: 'Null deref',
		ruleId: 'nodejs/no-null-deref',
		description: 'value may be null',
		impact: 'runtime crash',
		suggestion: 'guard the value',
		replacement: null,
		...overrides,
	};
}

describe('buildReviewReport', () => {
	it('keeps an incomplete review incomplete and carries failed-group diagnostics', async () => {
		const harness: ReviewHarness = {
			name: 'flaky',
			async review(context): Promise<ReviewResult> {
				if (context.diff.files[0].filename === 'f1.ts')
					throw new Error('group outage');
				return emptyResult({ filesReviewed: [context.diff.files[0].filename] });
			},
		};
		const result = await runReview(makeContext(['f0.ts', 'f1.ts']), harness, {
			maxFilesPerGroup: 1,
		});
		expect(result.reviewStatus).toBe('incomplete');
		expect(result.diagnostics?.failedGroups).toBe(1);

		const report = buildReviewReport({
			result,
			filesTotal: 2,
			filesExcluded: 0,
		});
		expect(report.status).toBe('incomplete');
		expect(report.diagnostics?.failedGroups).toBe(1);
	});

	it('never turns a failed group into a complete status', () => {
		const report = buildReviewReport({
			result: emptyResult({
				reviewStatus: 'complete',
				diagnostics: { failedGroups: 2 },
			}),
			filesTotal: 1,
			filesExcluded: 0,
		});
		expect(report.status).toBe('incomplete');
	});

	it('preserves an explicit stale or failed status', () => {
		for (const status of ['stale', 'failed'] as const) {
			const report = buildReviewReport({
				result: emptyResult({ reviewStatus: status }),
				filesTotal: 1,
				filesExcluded: 0,
			});
			expect(report.status).toBe(status);
		}
	});

	it('reports stable zero counts and full coverage fields for a clean review', () => {
		const report = buildReviewReport({
			result: emptyResult({ filesReviewed: ['src/a.ts'] }),
			filesTotal: 3,
			filesExcluded: 2,
		});
		expect(report.schemaVersion).toBe(1);
		expect(report.status).toBe('complete');
		expect(report.risk).toBe('none');
		expect(report.counts).toEqual({
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
		});
		expect(report.coverage).toEqual({
			filesReviewed: 1,
			filesTotal: 3,
			filesExcluded: 2,
			filesTruncated: false,
		});
		expect(report.findings).toEqual([]);
	});

	it('surfaces pagination truncation in coverage', () => {
		const report = buildReviewReport({
			result: emptyResult({ filesTruncated: true }),
			filesTotal: 5,
			filesExcluded: 0,
		});
		expect(report.coverage.filesTruncated).toBe(true);
	});

	it('serializes findings, diagnostics and rule coverage', () => {
		const result = emptyResult({
			findings: [finding()],
			counts: { critical: 0, high: 1, medium: 0, low: 0 },
			risk: 'high',
			filesReviewed: ['src/a.ts'],
			diagnostics: { failedGroups: 0, prelintRan: ['biome'] },
			ruleCoverage: {
				total: 4,
				passed: 0,
				assessed: 1,
				unassessed: 3,
				failedRules: ['nodejs/no-null-deref'],
			},
		});
		const report = buildReviewReport({
			result,
			filesTotal: 1,
			filesExcluded: 0,
		});
		expect(report.findings).toHaveLength(1);
		expect(report.findings[0].ruleId).toBe('nodejs/no-null-deref');

		const parsed = JSON.parse(serializeReviewReport(report));
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.status).toBe('complete');
		expect(parsed.findings[0]).toMatchObject({
			severity: 'high',
			path: 'src/a.ts',
			line: 12,
			ruleId: 'nodejs/no-null-deref',
			replacement: null,
		});
		expect(parsed.diagnostics.prelintRan).toEqual(['biome']);
		expect(parsed.ruleCoverage.failedRules).toEqual(['nodejs/no-null-deref']);
	});

	it('copies diagnostics arrays so the report cannot mutate the engine result', () => {
		const result = emptyResult({
			diagnostics: { prelintRan: ['biome'], prelintSkipped: ['semgrep'] },
		});
		const report = buildReviewReport({
			result,
			filesTotal: 1,
			filesExcluded: 0,
		});
		expect(report.diagnostics?.prelintRan).not.toBe(
			result.diagnostics?.prelintRan
		);
		expect(report.diagnostics?.prelintSkipped).not.toBe(
			result.diagnostics?.prelintSkipped
		);

		report.diagnostics?.prelintRan?.push('ruff');
		report.diagnostics?.prelintSkipped?.push('mypy');
		expect(result.diagnostics?.prelintRan).toEqual(['biome']);
		expect(result.diagnostics?.prelintSkipped).toEqual(['semgrep']);
	});

	it('redacts a known secret canary without mutating the engine result', () => {
		const canary = `ghp_${'A'.repeat(36)}`;
		const original = emptyResult({
			findings: [
				finding({
					description: `leaked credential ${canary} in fixture`,
					suggestion: 'rotate it',
				}),
			],
			diagnostics: { prelintRan: [`scanner-${canary}`] },
		});
		const report = buildReviewReport({
			result: original,
			filesTotal: 1,
			filesExcluded: 0,
		});
		const serialized = serializeReviewReport(report);

		expect(serialized).not.toContain(canary);
		expect(serialized).toContain('[REDACTED_GITHUB_TOKEN]');
		// The engine result must be untouched: the report is a copy and
		// redaction is applied only when the copy is serialized.
		expect(original.findings[0].description).toContain(canary);
		expect(original.diagnostics?.prelintRan?.[0]).toContain(canary);
		expect(report.findings[0]).not.toBe(original.findings[0]);
	});
});

describe('withReviewReportOutput', () => {
	const build = (
		result: ReviewResult,
		filesTotal: number,
		filesExcluded: number
	) =>
		serializeReviewReport(
			buildReviewReport({ result, filesTotal, filesExcluded })
		);

	it('returns the action result and writes the report on success', async () => {
		let emitted = '';
		const returned = await withReviewReportOutput(
			async () => 'published',
			() => build(emptyResult({ filesReviewed: ['src/a.ts'] }), 2, 1),
			(serialized) => {
				emitted = serialized;
			}
		);
		expect(returned).toBe('published');
		expect(JSON.parse(emitted).schemaVersion).toBe(1);
		expect(JSON.parse(emitted).coverage).toEqual({
			filesReviewed: 1,
			filesTotal: 2,
			filesExcluded: 1,
			filesTruncated: false,
		});
	});

	it('still calls writeOutput with the generated report when the action rejects, and the rejection propagates', async () => {
		const result = emptyResult({
			findings: [finding({ severity: 'critical' })],
			counts: { critical: 1, high: 0, medium: 0, low: 0 },
			risk: 'critical',
			filesReviewed: ['src/a.ts'],
		});
		let written: string | undefined;
		const failure = new Error('github publish failed');

		await expect(
			withReviewReportOutput(
				async () => {
					throw failure;
				},
				() => build(result, 1, 0),
				(serialized) => {
					written = serialized;
				}
			)
		).rejects.toBe(failure);

		expect(written).toBeDefined();
		const parsed = JSON.parse(written as string);
		expect(parsed.findings).toHaveLength(1);
		expect(parsed.counts.critical).toBe(1);
	});

	it('builds the report after the action settles so its mutations are included', async () => {
		const result = emptyResult({ filesReviewed: ['src/a.ts'] });
		let written = '';
		await withReviewReportOutput(
			async () => {
				// publishReview marks the result stale when the PR head moved
				// during the run, then returns without publishing.
				result.reviewStatus = 'stale';
			},
			() => build(result, 1, 0),
			(serialized) => {
				written = serialized;
			}
		);
		expect(JSON.parse(written).status).toBe('stale');
	});

	it('preserves the action error when the report writer also throws', async () => {
		const actionError = new Error('github publish failed');
		const emitError = new Error('setOutput exploded');

		await expect(
			withReviewReportOutput(
				async () => {
					throw actionError;
				},
				() => {
					throw emitError;
				},
				() => {}
			)
		).rejects.toBe(actionError);
	});

	it('preserves the action error when writeOutput also throws', async () => {
		const actionError = new Error('github publish failed');
		const writeError = new Error('setOutput exploded');

		await expect(
			withReviewReportOutput(
				async () => {
					throw actionError;
				},
				() => '{"schemaVersion":1}',
				() => {
					throw writeError;
				}
			)
		).rejects.toBe(actionError);
	});

	it('surfaces the report-emission error when the action itself succeeded', async () => {
		const emitError = new Error('setOutput exploded');

		await expect(
			withReviewReportOutput(
				async () => 'published',
				(): string => {
					throw emitError;
				},
				() => {}
			)
		).rejects.toBe(emitError);
	});

	it('surfaces the writeOutput error when buildReport succeeded', async () => {
		const writeError = new Error('setOutput exploded');

		await expect(
			withReviewReportOutput(
				async () => 'published',
				() => '{"schemaVersion":1}',
				() => {
					throw writeError;
				}
			)
		).rejects.toBe(writeError);
	});
});
