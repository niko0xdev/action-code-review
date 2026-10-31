import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishReview } from '../../src/github/review.js';
import {
	buildReviewPromptWithCoverage,
	parseHarnessFindings,
	toReviewResult,
} from '../../src/harness/harness.js';
import type { ReviewHarness } from '../../src/harness/harness.js';
import { incompleteReviewFailure } from '../../src/review/execution.js';
import { buildReviewReport } from '../../src/review/report.js';
import { runReview } from '../../src/review/reviewer.js';
import { applyVerifyPass } from '../../src/review/verify.js';
import {
	type IncompleteScenario,
	loadIncompleteScenarios,
} from './helpers/fixtures.js';
import { label, propertyTest } from './helpers/known-defects.js';
import {
	commentBodies,
	makeContext,
	recordingOctokit,
	reviewEvents,
	stubHarness,
} from './helpers/pipeline.js';

/**
 * Completion truth: whenever part of the review did not happen, the outcome
 * must say so and must never read as clean or approved. The publisher is set
 * up so an approval WOULD be submitted if it believed the review was clean
 * (auto-approve on, one resolved AI thread, no findings).
 */

const scenarios = loadIncompleteScenarios();
const OK_REPLY = JSON.stringify({
	findings: [],
	summary: 'No issues.',
	risk: 'none',
});

afterEach(() => {
	vi.restoreAllMocks();
});

function harnessFor(s: IncompleteScenario): ReviewHarness {
	const reply = s.modelOutput ?? OK_REPLY;
	switch (s.fault) {
		case 'api-failure':
			return stubHarness(
				new Error('LLM endpoint returned 503: upstream unavailable')
			);
		case 'truncated-diff':
			return {
				name: 'truncating-stub',
				async review(context) {
					// Same coverage accounting the Pi harness uses.
					const { includedFiles } = buildReviewPromptWithCoverage(
						context,
						undefined,
						{ maxContextChars: s.maxContextChars }
					);
					return toReviewResult(parseHarnessFindings(reply), includedFiles);
				},
			};
		case 'group-failure':
			return {
				name: 'flaky-stub',
				async review(context) {
					if (context.diff.files.some((f) => f.filename === 'src/b.ts'))
						throw new Error('Pi process exited with code 1');
					return toReviewResult(
						parseHarnessFindings(reply),
						context.diff.files.map((f) => f.filename)
					);
				},
			};
		default:
			return stubHarness(reply);
	}
}

async function execute(s: IncompleteScenario) {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	const context = makeContext(s.files);
	if (s.fault === 'pagination-truncated') context.diff.filesTruncated = true;
	const result = await runReview(context, harnessFor(s), {
		maxFilesPerGroup: s.fault === 'group-failure' ? 1 : 15,
	});
	if (s.fault === 'verify-error' || s.fault === 'verify-malformed') {
		await applyVerifyPass(result, {
			toolFindings: [],
			title: context.pullRequest.title,
			body: '',
			verify: async () => {
				if (s.fault === 'verify-error') throw new Error('verify 500');
				return 'I am unable to verify these findings.';
			},
		});
	}
	const stale =
		s.fault === 'stale-head' || s.fault === 'stale-head-recheck-error';
	const octokit = recordingOctokit({
		resolvedAiThread: true,
		...(s.fault === 'stale-head' ? { currentHeadSha: 'sha-moved' } : {}),
	});
	if (s.fault === 'stale-head-recheck-error')
		octokit.rest.pulls.get.mockRejectedValue(new Error('GitHub 502'));
	await publishReview(octokit as never, {
		owner: 'acme',
		repo: 'widget',
		prNumber: 7,
		headSha: 'sha-head',
		result,
		blockOnIssues: true,
		autoApproveWhenResolved: true,
		filesSelected: context.diff.files.length,
	});
	return { context, result, octokit, stale };
}

describe.each(scenarios)('completion truth: $fault / $id', (s) => {
	const kd = s.knownDefects;

	propertyTest(kd, 'status-not-complete')(
		label(kd, 'status-not-complete', s.id),
		async () => {
			const { result } = await execute(s);
			expect(result.reviewStatus).not.toBe('complete');
			expect(result.reviewStatus).toBeDefined();
		}
	);

	propertyTest(kd, 'failure-surfaced')(
		label(kd, 'failure-surfaced', s.id),
		async () => {
			const { result, context } = await execute(s);
			expect(
				incompleteReviewFailure({
					result,
					filesSelected: context.diff.files.length,
				})
			).not.toBeNull();
		}
	);

	propertyTest(kd, 'no-approval')(label(kd, 'no-approval', s.id), async () => {
		const { octokit } = await execute(s);
		expect(reviewEvents(octokit)).not.toContain('APPROVE');
		const text = commentBodies(octokit).join('\n');
		expect(text).not.toMatch(/APPROVED|All clear|NO BLOCKING FINDINGS/);
	});

	propertyTest(kd, 'report-status')(
		label(kd, 'report-status', s.id),
		async () => {
			const { result, context } = await execute(s);
			expect(
				buildReviewReport({
					result,
					filesTotal: context.diff.files.length,
					filesExcluded: 0,
				}).status
			).not.toBe('complete');
		}
	);

	propertyTest(kd, 'summary-says-incomplete')(
		label(kd, 'summary-says-incomplete', s.id),
		async () => {
			const { octokit, stale } = await execute(s);
			const bodies = commentBodies(octokit);
			if (stale) {
				// Nothing about a stale head may be posted as if current.
				expect(bodies).toEqual([]);
				expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
				return;
			}
			expect(bodies.join('\n')).toContain('REVIEW INCOMPLETE');
		}
	);
});

describe('findings survive verification errors', () => {
	it.each(scenarios.filter((s) => s.fault.startsWith('verify-')))(
		'$id keeps the high finding',
		async (s) => {
			const { result } = await execute(s);
			expect(result.findings).toHaveLength(1);
			expect(result.findings[0].severity).toBe('high');
		}
	);
});

describe('fault coverage', () => {
	it('exercises every fault kind', () => {
		expect([...new Set(scenarios.map((s) => s.fault))].sort()).toEqual([
			'api-failure',
			'group-failure',
			'pagination-truncated',
			'schema-refusal',
			'stale-head',
			'stale-head-recheck-error',
			'truncated-diff',
			'verify-error',
			'verify-malformed',
		]);
	});
});
