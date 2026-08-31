import { prioritizeFiles } from '../context/files.js';
import type { ReviewHarness } from '../harness/harness.js';
import type { ReviewContext } from '../types/context.js';
import {
	FINDING_LIMITS,
	type Finding,
	type ReviewResult,
	SEVERITY_ORDER,
} from '../types/finding.js';
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
				allFindings.push(
					...capFindings(
						outcome.value.result.findings.slice(0, FINDING_LIMITS.overall)
					)
				);
				filesReviewed.push(...group.files);
				if (outcome.value.result.summary)
					summaries.push(outcome.value.result.summary);
			} else {
				console.warn(
					`Review group failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`
				);
			}
		}
	}

	const minimum =
		options.minSeverity === undefined
			? SEVERITY_ORDER.low
			: (SEVERITY_ORDER[options.minSeverity as keyof typeof SEVERITY_ORDER] ??
				SEVERITY_ORDER.critical);
	const filtered = allFindings.filter(
		(finding) => SEVERITY_ORDER[finding.severity] >= minimum
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
