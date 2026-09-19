/**
 * Shared status vocabulary for review lifecycle reporting.
 *
 * Kept intentionally narrow: every value is rendered in user-facing summaries,
 * so adding a status is a product decision, not a local one.
 */

export const REVIEW_STATUSES = [
	'complete',
	'incomplete',
	'failed',
	'stale',
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Statuses that must never be presented as a clean result. */
export const NON_CLEAN_STATUSES: readonly ReviewStatus[] = REVIEW_STATUSES.filter(
	(status) => status !== 'complete'
);

export function isCleanStatus(status: ReviewStatus): boolean {
	return status === 'complete';
}

/** Human-readable label, e.g. `complete` -> `Complete`. */
export function labelForStatus(status: ReviewStatus): string {
	const [first = '', ...rest] = status;
	return `${first.toUpperCase()}${rest.join('')}`;
}

/** True when the status should be surfaced as a warning in summaries. */
export function needsAttention(status: ReviewStatus): boolean {
	return !isCleanStatus(status);
}
