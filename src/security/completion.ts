import type { SecurityConclusion, SecuritySeverity } from './types.js';

/**
 * Convert security completion state into the action-level failure decision.
 * An incomplete analysis is never equivalent to a clean security review.
 */
export function securityFailureMessage(
	conclusion: SecurityConclusion,
	failOn: SecuritySeverity | 'none'
): string | undefined {
	if (conclusion.incomplete) {
		return 'Security review incomplete: one or more required analysis components failed.';
	}
	if (conclusion.failThresholdReached) {
		return `Security review failed: found vulnerabilities reaching or exceeding fail threshold (${failOn}).`;
	}
	return undefined;
}
