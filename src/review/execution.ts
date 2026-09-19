/**
 * Execution reporting for one review run.
 *
 * Two questions must be answerable from the run itself, without reading the
 * action's source: "did the review actually run over everything it says it
 * reviewed?" and "did the bot approve the PR?". This module owns the
 * deterministic answers used by the step summary, the failure decision, and
 * the opt-in raw harness dump.
 */

import { redactSecrets } from '../security/redaction/redactor.js';
import type { ReviewResult } from '../types/finding.js';

export interface ReviewExecutionInput {
	result: Pick<
		ReviewResult,
		'reviewStatus' | 'diagnostics' | 'filesReviewed' | 'findings' | 'approval'
	>;
	/**
	 * Files the review was asked to analyze: the PR files that survived
	 * `exclude-patterns`/`max-files` filtering. This is the denominator for
	 * "was everything analyzed?" — using the raw PR file count instead would
	 * report every intentionally excluded file as missing coverage.
	 */
	filesSelected: number;
}

export interface ReviewExecution {
	/** True when every selected file produced a result and no group failed. */
	complete: boolean;
	filesReviewed: number;
	filesSelected: number;
	filesNotAnalyzed: number;
	failedGroups: number;
	status: 'complete' | 'incomplete' | 'failed' | 'stale';
}

export function describeReviewExecution(
	input: ReviewExecutionInput
): ReviewExecution {
	const failedGroups = input.result.diagnostics?.failedGroups ?? 0;
	const status = input.result.reviewStatus ?? 'complete';
	const filesReviewed = input.result.filesReviewed.length;
	const reportedNotAnalyzed = input.result.diagnostics?.filesNotAnalyzed ?? 0;
	const filesNotAnalyzed = Math.max(
		reportedNotAnalyzed,
		input.filesSelected - filesReviewed
	);
	return {
		complete:
			status === 'complete' && failedGroups === 0 && filesNotAnalyzed <= 0,
		filesReviewed,
		filesSelected: input.filesSelected,
		filesNotAnalyzed,
		failedGroups,
		status,
	};
}

/**
 * Reason the step should fail, or `null` when the run is a genuine success.
 * A crashed harness group used to leave the step green and post a summary that
 * looked like a clean review, so the caller can now surface it as a failure.
 */
export function incompleteReviewFailure(
	input: ReviewExecutionInput
): string | null {
	const execution = describeReviewExecution(input);
	if (execution.complete) return null;
	const reasons = [
		execution.status !== 'complete' ? `status ${execution.status}` : '',
		execution.failedGroups > 0
			? `${execution.failedGroups} review group(s) failed`
			: '',
		execution.filesNotAnalyzed > 0
			? `${execution.filesNotAnalyzed} of ${execution.filesSelected} selected file(s) were not analyzed`
			: '',
	].filter(Boolean);
	return `Review incomplete (${reasons.join('; ')}). No approval was submitted. Re-run the workflow; if it keeps failing, check the harness output above.`;
}

/** Hard cap on the raw dump written to the job summary, in characters. */
export const RAW_HARNESS_SUMMARY_MAX_CHARS = 60 * 1024;

/**
 * Opt-in raw harness dump. `AI_REVIEW_DEBUG_HARNESS` accepts `1`/`true` for the
 * default budget or a positive byte count; anything else disables it. The dump
 * is redacted and truncated, and lands in the step summary so an operator can
 * see what the model actually produced without re-running the review.
 */
export function rawHarnessDumpEnabled(
	env: NodeJS.ProcessEnv = process.env
): number | null {
	const raw = env.AI_REVIEW_DEBUG_HARNESS?.trim();
	if (!raw) return null;
	if (raw === '1' || raw.toLowerCase() === 'true')
		return RAW_HARNESS_SUMMARY_MAX_CHARS;
	const bytes = Number(raw);
	if (!Number.isFinite(bytes) || bytes <= 0) return null;
	return Math.min(Math.floor(bytes), 5 * 1024 * 1024);
}

export function buildRawHarnessSection(
	runs: readonly { stdout: string; stderr: string }[],
	maxChars: number
): string | null {
	if (runs.length === 0) return null;
	const combined = runs
		.map((run, index) => {
			const header =
				runs.length > 1 ? `--- run ${index + 1}/${runs.length} ---\n` : '';
			const stderr = run.stderr
				? `\n[stderr]\n${redactSecrets(run.stderr)}`
				: '';
			return `${header}${redactSecrets(run.stdout)}${stderr}`;
		})
		.join('\n\n')
		.trim();
	if (!combined) return null;
	// Untrusted model output must not break out of the fence or the details tag.
	let body = combined
		.replaceAll('```', '\\`\\`\\`')
		.replaceAll('</details>', '&lt;/details&gt;');
	let truncated = false;
	if (body.length > maxChars) {
		body = `${body.slice(0, maxChars)}\n\n... truncated (${combined.length - maxChars} of ${combined.length} chars omitted)`;
		truncated = true;
	}
	return `<details><summary>Raw harness output (debug)${truncated ? ' _(truncated)_' : ''}</summary>\n\n\`\`\`\n${body}\n\`\`\`\n\n</details>`;
}
