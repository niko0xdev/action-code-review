import { prioritizeFiles } from '../context/files.js';
import type { ReviewHarness } from '../harness/harness.js';
import type { ReviewContext } from '../types/context.js';
import type { Finding, ReviewResult } from '../types/finding.js';
import { dedupeFindings } from './dedupe.js';
import { planReviewGroups } from './planner.js';
import { capFindings, computeCounts } from './severity.js';
import { validateFindings } from './validator.js';

/**
 * Review orchestration: plan groups → run the harness per group → merge,
 * validate (spec §18), dedupe and cap findings (spec §19).
 */

export interface RunReviewOptions {
	maxFilesPerGroup?: number;
	minConfidence?: number;
	/** Extra prompt rules forwarded to the harness. */
	extraRules?: string;
}

export async function runReview(
	context: ReviewContext,
	harness: ReviewHarness,
	options: RunReviewOptions = {}
): Promise<ReviewResult> {
	const maxFilesPerGroup = options.maxFilesPerGroup ?? 15;
	const minConfidence = options.minConfidence ?? 0.8;

	const reviewable = prioritizeFiles(
		context.diff.files,
		Number.MAX_SAFE_INTEGER
	);
	const scoped: ReviewContext = {
		...context,
		diff: {
			...context.diff,
			files: reviewable,
		},
	};

	const groups = planReviewGroups(scoped, maxFilesPerGroup);
	const allFindings: Finding[] = [];
	const summaries: string[] = [];
	const filesReviewed: string[] = [];

	for (const group of groups) {
		const groupContext: ReviewContext = {
			...scoped,
			diff: {
				...scoped.diff,
				files: scoped.diff.files.filter((f) =>
					group.files.includes(f.filename)
				),
			},
		};

		const result = await harness.review(groupContext);
		allFindings.push(...result.findings);
		filesReviewed.push(...group.files);
		if (result.summary) {
			summaries.push(result.summary);
		}
	}

	const validated = capFindings(
		dedupeFindings(
			validateFindings(allFindings, context.diff.files, minConfidence)
		)
	);

	return {
		findings: validated.sort((a, b) => b.confidence - a.confidence),
		summary: summaries.join('\n\n').trim(),
		risk: computeRisk(validated),
		counts: computeCounts(validated),
		filesReviewed,
	};
}

function computeRisk(findings: Finding[]): ReviewResult['risk'] {
	if (findings.some((f) => f.severity === 'critical')) {
		return 'critical';
	}
	const high = findings.filter((f) => f.severity === 'high').length;
	if (high >= 2) {
		return 'critical';
	}
	if (high === 1) {
		return 'high';
	}
	if (findings.some((f) => f.severity === 'medium')) {
		return 'medium';
	}
	if (findings.some((f) => f.severity === 'low')) {
		return 'low';
	}
	return 'none';
}
