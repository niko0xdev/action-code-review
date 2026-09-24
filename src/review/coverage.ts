import { isReviewable } from '../context/files.js';
import { redactSecrets } from '../security/redaction/redactor.js';
import type { ChangedFile } from '../types/context.js';

export type ReviewFileCoverageStatus = 'reviewed' | 'excluded' | 'not-analyzed';

export type ReviewFileCoverageReason =
	| 'configured-filter'
	| 'missing-patch'
	| 'default-ignore'
	| 'max-files'
	| 'review-group-failed'
	| 'review-incomplete';

export interface ReviewFileCoverage {
	path: string;
	status: ReviewFileCoverageStatus;
	reason?: ReviewFileCoverageReason;
}

export interface BuildFileCoverageInput {
	files: readonly ChangedFile[];
	filteredPaths: readonly string[];
	selectedPaths: readonly string[];
	reviewedPaths: readonly string[];
	failedGroups: number;
}

export interface ReviewFileCoverageLedger {
	files: ReviewFileCoverage[];
	filesOmitted: number;
	fileDetailsTruncated: boolean;
}

/** Keep the additive path ledger well below GitHub's per-job output limit. */
export const MAX_FILE_COVERAGE_CHARS = 128 * 1024;

/**
 * Account for each PR file using the same filter order as the review pipeline.
 * A selected file absent from `reviewedPaths` is never presented as excluded.
 * Stop at a bounded serialized size and report omitted detail explicitly.
 */
export function buildFileCoverage(
	input: BuildFileCoverageInput,
	maxChars = MAX_FILE_COVERAGE_CHARS
): ReviewFileCoverageLedger {
	const filtered = new Set(input.filteredPaths);
	const selected = new Set(input.selectedPaths);
	const reviewed = new Set(input.reviewedPaths);
	const files: ReviewFileCoverage[] = [];
	const sizeLimit =
		Number.isSafeInteger(maxChars) && maxChars >= 2
			? Math.min(maxChars, MAX_FILE_COVERAGE_CHARS)
			: MAX_FILE_COVERAGE_CHARS;
	let serializedChars = 2; // JSON array brackets

	for (const [index, file] of input.files.entries()) {
		const path = file.filename;
		let entry: ReviewFileCoverage;
		if (!filtered.has(path))
			entry = { path, status: 'excluded', reason: 'configured-filter' };
		else if (!file.patch)
			entry = { path, status: 'excluded', reason: 'missing-patch' };
		else if (!isReviewable(file))
			entry = { path, status: 'excluded', reason: 'default-ignore' };
		else if (!selected.has(path))
			entry = { path, status: 'excluded', reason: 'max-files' };
		else if (reviewed.has(path)) entry = { path, status: 'reviewed' };
		else {
			entry = {
				path,
				status: 'not-analyzed',
				reason:
					input.failedGroups > 0 ? 'review-group-failed' : 'review-incomplete',
			};
		}

		// Size the value that will actually be serialized, including any
		// redaction expansion for a secret-like path.
		const outputEntry = { ...entry, path: redactSecrets(entry.path) };
		const entryChars =
			JSON.stringify(outputEntry).length + (files.length > 0 ? 1 : 0);
		if (serializedChars + entryChars > sizeLimit) {
			return {
				files,
				filesOmitted: input.files.length - index,
				fileDetailsTruncated: true,
			};
		}
		files.push(entry);
		serializedChars += entryChars;
	}
	return { files, filesOmitted: 0, fileDetailsTruncated: false };
}
