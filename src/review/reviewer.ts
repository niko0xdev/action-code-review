import { prioritizeFiles } from '../context/files.js';
import type { ReviewHarness } from '../harness/harness.js';
import { combinedRules } from '../profiles/rules.js';
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
import {
	hasTestFileChanges,
	normalizeCategories,
	resolveCrossFindingConflicts,
	sanitizeReplacements,
	trivialPrFastPath,
} from './validation.js';
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
	let failedGroups = 0;

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
				failedGroups += 1;
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

	// Pipeline additions (spec §18):
	// 1) category vocabulary -> bucket unknown to low
	// 2) suggestion safety -> strip unsafe replacements
	// 3) dedupe -> cross-finding consistency -> cap
	const normalized = normalizeCategories(validated);
	const sanitized = sanitizeReplacements(normalized.findings);
	const deduped = dedupeFindings(sanitized);
	const crossChecked = resolveCrossFindingConflicts(deduped);
	const fastPathed = trivialPrFastPath(crossChecked.findings, {
		totalChanges: context.diff.totalAdditions + context.diff.totalDeletions,
		hasTestFileChanges: hasTestFileChanges(
			context.diff.files.map((f) => f.filename)
		),
	});
	const findings = capFindings(fastPathed.findings).sort(
		(a, b) => b.confidence - a.confidence
	);

	const result: ReviewResult = {
		findings,
		summary: summaries.join('\n\n').trim(),
		risk: riskFromFindings(findings),
		counts: computeCounts(findings),
		filesReviewed,
		ruleCoverage: deriveRuleCoverage(context, findings),
	};
	// Phase 3 diagnostics: bucket count + conflict drop count + trivial flag.
	// Preserve any toolFindings already set by cli.ts so reviewers don't
	// overwrite upstream phases.
	if (
		normalized.bucketedCount > 0 ||
		crossChecked.droppedCount > 0 ||
		fastPathed.trivialPr ||
		failedGroups > 0
	) {
		result.diagnostics = {
			...result.diagnostics,
			bucketedUnknownCategories: normalized.bucketedCount,
			crossFindingConflictsResolved: crossChecked.droppedCount,
			trivialPrFastPath: fastPathed.trivialPr,
			...(failedGroups > 0 ? { failedGroups } : {}),
		};
	}
	return result;
}

function deriveRuleCoverage(
	context: ReviewContext,
	findings: Finding[]
): ReviewResult['ruleCoverage'] {
	const rulesText = combinedRules(context.profiles.map((p) => p.id));
	const total = rulesText
		.split('\n')
		.filter((line) => line.trim().startsWith('-')).length;
	if (total === 0) return undefined;
	const failedRules = [
		...new Set(
			findings
				.map((f) => f.ruleId?.trim())
				.filter((id): id is string => Boolean(id && id.length > 0))
		),
	];
	const passed = Math.max(total - failedRules.length, 0);
	return { total, passed, failedRules };
}
