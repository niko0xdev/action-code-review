/**
 * Machine-readable review report (`review-report` action output).
 *
 * Serializes a copy of the validated review result into a versioned,
 * stable JSON shape. This is an additive output: the frozen V1 surface
 * (`docs/v1-interface-contract.md`) is unchanged.
 *
 * Redaction is pattern-based (`redactSecrets`), applied to every string
 * value of the serialized copy. It is a defence-in-depth backstop, not a
 * general secret detector.
 */

import { redactSecrets } from '../security/redaction/redactor.js';
import type {
	Finding,
	FindingCategory,
	FindingCounts,
	ReviewDiagnostics,
	ReviewResult,
	RiskLevel,
	RuleCoverage,
	Severity,
} from '../types/finding.js';

/** Bumped only for breaking changes to the serialized shape. */
export const REVIEW_REPORT_SCHEMA_VERSION = 1 as const;

/**
 * Report status. `failed` is **reserved and never emitted by the current
 * pipeline**: failed review groups are reported as `incomplete`, and a run
 * that fails before a `ReviewResult` exists emits no report at all. The value
 * is accepted defensively, and handled like any other non-complete status, so
 * a future pipeline can set it without a schema bump.
 */
export type ReviewReportStatus = 'complete' | 'incomplete' | 'failed' | 'stale';

export interface ReviewReportFinding {
	severity: Severity;
	confidence: number;
	category: FindingCategory;
	path: string;
	line: number;
	title: string;
	ruleId?: string;
	description: string;
	impact: string;
	suggestion?: string;
	replacement?: string | null;
}

export interface ReviewReportCoverage {
	/**
	 * Files that produced a review result for at least one group. Files in a
	 * failed group are absent, so on an incomplete review
	 * `filesReviewed + filesExcluded` can be less than `filesTotal`.
	 */
	filesReviewed: number;
	/**
	 * Number of files returned by the PR file listing, before any filtering.
	 * When the listing safety cap is hit, `filesTruncated` is `true` and this
	 * may be below the actual PR file count.
	 */
	filesTotal: number;
	/**
	 * `filesTotal` minus the files that survived filtering (`src/cli.ts`).
	 * Bundles every reason a file was not reviewed: exclude patterns, a
	 * missing patch, and the `max-files` cap. Files in a failed group are
	 * neither reviewed nor excluded, so on an incomplete review
	 * `filesReviewed + filesExcluded` can be less than `filesTotal`.
	 */
	filesExcluded: number;
	/** True when the PR file list hit a pagination safety cap. */
	filesTruncated: boolean;
}

export interface ReviewReport {
	schemaVersion: typeof REVIEW_REPORT_SCHEMA_VERSION;
	status: ReviewReportStatus;
	risk: RiskLevel;
	counts: FindingCounts;
	coverage: ReviewReportCoverage;
	findings: ReviewReportFinding[];
	diagnostics?: ReviewDiagnostics;
	ruleCoverage?: RuleCoverage;
}

export interface BuildReviewReportInput {
	/** Validated/capped engine result. Never mutated. */
	result: ReviewResult;
	/**
	 * Files returned by the PR file listing before filtering (see cli.ts and
	 * {@link ReviewReportCoverage.filesTotal}).
	 */
	filesTotal: number;
	/** Files dropped as non-reviewable (see {@link ReviewReportCoverage}). */
	filesExcluded: number;
}

/**
 * Derive the reported status conservatively: a group failure can never be
 * reported as complete, and an unknown status is treated as incomplete
 * rather than assumed clean.
 */
function deriveStatus(result: ReviewResult): ReviewReportStatus {
	const failedGroups =
		typeof result.diagnostics?.failedGroups === 'number'
			? result.diagnostics.failedGroups
			: 0;
	if (failedGroups > 0) return 'incomplete';
	const status = result.reviewStatus;
	if (status === 'failed' || status === 'stale' || status === 'incomplete')
		return status;
	if (status === 'complete') return 'complete';
	return 'incomplete';
}

function copyFinding(finding: Finding): ReviewReportFinding {
	return { ...finding };
}

/**
 * Build the report object. The returned value is a fresh copy: mutating it
 * cannot affect the engine result, and no redaction is applied here (only
 * {@link serializeReviewReport} redacts).
 */
export function buildReviewReport(input: BuildReviewReportInput): ReviewReport {
	const { result } = input;
	const report: ReviewReport = {
		schemaVersion: REVIEW_REPORT_SCHEMA_VERSION,
		status: deriveStatus(result),
		risk: result.risk,
		counts: { ...result.counts },
		coverage: {
			filesReviewed: result.filesReviewed.length,
			filesTotal: input.filesTotal,
			filesExcluded: input.filesExcluded,
			filesTruncated: Boolean(result.filesTruncated),
		},
		findings: result.findings.map(copyFinding),
	};
	if (result.diagnostics) {
		report.diagnostics = { ...result.diagnostics };
		if (result.diagnostics.prelintRan)
			report.diagnostics.prelintRan = [...result.diagnostics.prelintRan];
		if (result.diagnostics.prelintSkipped)
			report.diagnostics.prelintSkipped = [
				...result.diagnostics.prelintSkipped,
			];
	}
	if (result.ruleCoverage) {
		report.ruleCoverage = {
			...result.ruleCoverage,
			failedRules: [...result.ruleCoverage.failedRules],
		};
	}
	return report;
}

/**
 * Apply pattern-based redaction to every string in a JSON-ish value while
 * building a fresh copy. Arrays and plain objects are rebuilt; primitives
 * are returned unchanged.
 */
function redactValue(value: unknown): unknown {
	if (typeof value === 'string') return redactSecrets(value);
	if (Array.isArray(value)) return value.map(redactValue);
	if (value !== null && typeof value === 'object') {
		const source = value as Record<string, unknown>;
		const copy: Record<string, unknown> = {};
		for (const key of Object.keys(source)) copy[key] = redactValue(source[key]);
		return copy;
	}
	return value;
}

/**
 * Serialize the report to JSON with every string value passed through
 * `redactSecrets`. The input report is not mutated.
 */
export function serializeReviewReport(report: ReviewReport): string {
	return JSON.stringify(redactValue(report));
}

/**
 * Run `action`, then always attempt to hand `buildReport()` to `writeOutput`;
 * report emission is attempted even when `action` rejects.
 *
 * `buildReport` runs after `action` has settled, so state it mutates (for
 * example a `stale` status set while publishing) is reflected in the report.
 * Kept generic and separate from the CLI so the emission path is testable
 * without a live GitHub client: the report describes the analysis result and
 * must usually survive a publication failure.
 *
 * Error precedence: when `action` rejects, its error is the original cause of
 * the failure and is rethrown unchanged, even if building or writing the
 * report also throws — a report-emission error must never mask the real
 * failure. When `action` succeeds, a build or write error propagates as-is.
 */
export async function withReviewReportOutput<T, R>(
	action: () => Promise<T>,
	buildReport: () => R,
	writeOutput: (report: R) => void
): Promise<T> {
	let result: T;
	try {
		result = await action();
	} catch (actionError) {
		try {
			writeOutput(buildReport());
		} catch {
			// Deliberately swallowed: the action error stays primary.
		}
		throw actionError;
	}
	// Action succeeded: a report build/write failure is the only error and
	// must surface.
	writeOutput(buildReport());
	return result;
}
