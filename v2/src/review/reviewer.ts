import { prioritizeFiles } from '../context/files.js';
import type { ReviewHarness } from '../harness/harness.js';
import type { ReviewContext } from '../types/context.js';
import type { Finding, ReviewResult } from '../types/finding.js';
import { dedupeFindings } from './dedupe.js';
import { planReviewGroups } from './planner.js';
import { capFindings, computeCounts, riskFromFindings } from './severity.js';
import { validateFindings } from './validator.js';

export interface RunReviewOptions {
	maxFilesPerGroup?: number;
	minConfidence?: number;
	extraRules?: string;
	minSeverity?: string;
}

const SEVERITY_RANK: Record<string, number> = {
	low: 0,
	medium: 1,
	high: 2,
	critical: 3,
};

export async function runReview(
	context: ReviewContext,
	harness: ReviewHarness,
	options: RunReviewOptions = {}
): Promise<ReviewResult> {
	const reviewable = prioritizeFiles(
		context.diff.files,
		Number.MAX_SAFE_INTEGER
	);
	const scoped: ReviewContext = {
		...context,
		diff: { ...context.diff, files: reviewable },
	};
	const groups = planReviewGroups(scoped, options.maxFilesPerGroup ?? 15);
	const allFindings: Finding[] = [];
	const summaries: string[] = [];
	const filesReviewed: string[] = [];

	for (let start = 0; start < groups.length; start += 3) {
		const outcomes = await Promise.allSettled(
			groups.slice(start, start + 3).map(async (group) => {
				const groupContext: ReviewContext = {
					...scoped,
					diff: {
						...scoped.diff,
						files: scoped.diff.files.filter((f) =>
							group.files.includes(f.filename)
						),
					},
				};
				return { group, result: await harness.review(groupContext) };
			})
		);
		for (const [index, outcome] of outcomes.entries()) {
			const group = groups[start + index];
			if (outcome.status === 'fulfilled') {
				allFindings.push(...outcome.value.result.findings);
				filesReviewed.push(...group.files);
				if (outcome.value.result.summary) summaries.push(outcome.value.result.summary);
			} else {
				console.warn(
					`Review group failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`
				);
			}
		}
	}

	const minimum =
		SEVERITY_RANK[options.minSeverity ?? 'low'] ?? SEVERITY_RANK.critical;
	const filtered = allFindings.filter(
		(finding) => SEVERITY_RANK[finding.severity] >= minimum
	);
	const validated = validateFindings(
		filtered,
		context.diff.files,
		options.minConfidence ?? 0.8
	);
	const findings = capFindings(dedupeFindings(validated)).sort(
		(a, b) => b.confidence - a.confidence
	);
	return {
		findings,
		summary: summaries.join('\n\n').trim(),
		risk: riskFromFindings(findings),
		counts: computeCounts(findings),
		filesReviewed,
	};
}
