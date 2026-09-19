import { describe, expect, it } from 'vitest';
import { applyLegacyFilters } from '../../src/cli.js';
import { prioritizeFiles } from '../../src/context/files.js';
import {
	buildReviewPayload,
	buildSummaryBody,
} from '../../src/github/review.js';
import type { ReviewHarness } from '../../src/harness/harness.js';
import { runReview } from '../../src/review/reviewer.js';
import type { ReviewContext } from '../../src/types/context.js';
import type {
	Finding,
	ReviewResult,
	ReviewUsageMetrics,
} from '../../src/types/finding.js';

const PATCH = '@@ -1 +1,2 @@\n value\n+changed';

function makeContext(prNumber: number, filenames: string[]): ReviewContext {
	return {
		repository: { owner: 'acme', repo: 'widget' },
		pullRequest: {
			number: prNumber,
			title: `Scenario PR #${prNumber}`,
			body: '',
			author: 'dev',
			headRef: `scenario-${prNumber}`,
			baseRef: 'main',
			headSha: `head-${prNumber}`,
			baseSha: 'base',
			draft: false,
		},
		diff: {
			files: filenames.map((filename) => ({
				filename,
				status: 'modified' as const,
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: PATCH,
			})),
			totalAdditions: filenames.length,
			totalDeletions: 0,
		},
		profiles: [{ id: 'typescript', evidence: ['scenario'] }],
		repositoryPath: '/repo',
	};
}

function cleanResult(files: string[]): ReviewResult {
	return {
		findings: [],
		summary: 'The reviewed changes contain no actionable findings.',
		risk: 'none',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: files,
	};
}

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		severity: 'high',
		confidence: 0.95,
		category: 'security',
		path: 'src/query.ts',
		line: 2,
		title: 'Tenant boundary missing',
		description: 'The query does not constrain the tenant.',
		impact: "A user may read another tenant's data.",
		suggestion: 'Add tenantId to the query predicate.',
		replacement: null,
		...overrides,
	};
}

function usage(processes: ReviewUsageMetrics['processes']): ReviewUsageMetrics {
	return {
		inputTokens: 100,
		outputTokens: 30,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 130,
		assistantMessages: 2,
		toolCallsStarted: 1,
		durationMs: 25,
		processes,
	};
}

interface Scenario {
	name: string;
	prNumber: number;
	filenames: string[];
	result: (files: string[]) => ReviewResult;
	assert: (result: ReviewResult, summary: string) => void;
}

const scenarios: Scenario[] = [
	{
		name: 'clean PR with successful harness execution',
		prNumber: 201,
		filenames: ['src/clean.ts'],
		result: (files) => cleanResult(files),
		assert: (result, summary) => {
			expect(result.reviewStatus).toBe('complete');
			expect(result.findings).toEqual([]);
			expect(summary).toContain('**Review execution:** complete');
			expect(summary).toContain('1 files analyzed');
		},
	},
	{
		name: 'high finding requests changes',
		prNumber: 202,
		filenames: ['src/query.ts'],
		result: (files) => ({
			...cleanResult(files),
			findings: [finding()],
			summary: 'A security issue was found.',
			risk: 'high',
			counts: { critical: 0, high: 1, medium: 0, low: 0 },
		}),
		assert: (result, summary) => {
			const payload = buildReviewPayload(result.findings, 'head-202', {
				blockOnIssues: true,
			});
			expect(payload.event).toBe('REQUEST_CHANGES');
			expect(payload.comments).toHaveLength(1);
			expect(summary).toContain('High: 1');
			expect(summary).toContain('CHANGES REQUESTED');
		},
	},
	{
		name: 'invalid and duplicate findings are reduced to one publishable issue',
		prNumber: 206,
		filenames: ['src/query.ts'],
		result: (files) => ({
			...cleanResult(files),
			findings: [
				finding(),
				finding(),
				finding({ line: 99, title: 'Unchanged-line issue' }),
				finding({ confidence: 0.4, title: 'Low-confidence duplicate' }),
			],
			summary: 'The candidate set contains duplicate and invalid entries.',
			risk: 'high',
			counts: { critical: 0, high: 4, medium: 0, low: 0 },
		}),
		assert: (result, summary) => {
			expect(result.findings).toHaveLength(1);
			expect(result.findings[0].title).toBe('Tenant boundary missing');
			expect(summary).toContain('High: 1');
		},
	},
	{
		name: 'low-only finding remains non-blocking',
		prNumber: 203,
		filenames: ['src/style.ts'],
		result: (files) => ({
			...cleanResult(files),
			findings: [
				finding({
					severity: 'low',
					category: 'maintainability',
					title: 'Naming could be clearer',
				}),
			],
			counts: { critical: 0, high: 0, medium: 0, low: 1 },
			risk: 'low',
		}),
		assert: (result, summary) => {
			const payload = buildReviewPayload(result.findings, 'head-203');
			expect(payload.event).toBe('COMMENT');
			expect(summary).toContain('APPROVED');
		},
	},
	{
		name: 'filtered documentation is excluded while source is reviewed',
		prNumber: 204,
		filenames: ['README.md', 'src/kept.ts', 'config.yaml'],
		result: (files) => cleanResult(files),
		assert: (result, summary) => {
			expect(result.filesReviewed).toEqual(['src/kept.ts']);
			expect(summary).toContain('1 of 3 (2 excluded by filter)');
		},
	},
	{
		name: 'provider failure produces incomplete review',
		prNumber: 205,
		filenames: ['src/provider-error.ts'],
		result: () => cleanResult([]),
		assert: (result, summary) => {
			expect(result.reviewStatus).toBe('incomplete');
			expect(result.filesReviewed).toEqual([]);
			expect(result.diagnostics?.failedGroups).toBe(1);
			expect(summary).toContain('REVIEW INCOMPLETE — NO APPROVAL');
		},
	},
];

describe('end-to-end PR scenario matrix', () => {
	it.each(scenarios)('$name (PR #$prNumber)', async (scenario) => {
		const context = makeContext(scenario.prNumber, scenario.filenames);
		const filtered = applyLegacyFilters(
			context.diff.files.map((file) => file.filename),
			{ excludePatterns: ['*.md', '*.yaml'] }
		);
		const selected = prioritizeFiles(
			context.diff.files.filter((file) => filtered.includes(file.filename)),
			10
		);
		const selectedNames = selected.map((file) => file.filename);
		const scenarioUsage =
			scenario.prNumber === 205
				? usage({ started: 1, succeeded: 0, failed: 1 })
				: usage({ started: 1, succeeded: 1, failed: 0 });
		const harness: ReviewHarness = {
			name: 'scenario-harness',
			usage: scenarioUsage,
			async review(groupContext): Promise<ReviewResult> {
				if (scenario.prNumber === 205)
					throw new Error('Pi assistant request failed: gateway timeout');
				return scenario.result(
					groupContext.diff.files.map((file) => file.filename)
				);
			},
		};

		const result = await runReview(
			{ ...context, diff: { ...context.diff, files: selected } },
			harness,
			{ maxFilesPerGroup: 10 }
		);
		const summary = buildSummaryBody({
			...result,
			filesTotal: context.diff.files.length,
			filesExcluded: context.diff.files.length - selectedNames.length,
		});

		scenario.assert(result, summary);
	});
});
