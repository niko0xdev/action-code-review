import type { OctokitLike } from '../context/pr.js';
import type { Finding, ReviewResult } from '../types/finding.js';
import { buildFindingBody, buildSummaryBody } from './comments.js';

export { buildFindingBody, buildSummaryBody } from './comments.js';

/** Minimal publisher surface; extends the read shape with write calls. */
export interface PublisherOctokit extends OctokitLike {
	rest: OctokitLike['rest'] & {
		pulls: OctokitLike['rest']['pulls'] & {
			createReview(args: Record<string, unknown>): Promise<{ data: unknown }>;
		};
		issues: {
			createComment(args: Record<string, unknown>): Promise<{ data: unknown }>;
		};
	};
}

/**
 * GitHub review publisher (spec §20/§25): inline comments on changed
 * lines via a single review submission, plus the PR summary comment.
 * Requires only contents:read + pull-requests:write.
 */

export interface ReviewCommentWire {
	path: string;
	line: number;
	side: 'RIGHT';
	body: string;
}

export interface ReviewPayload {
	commit_id: string;
	event: 'REQUEST_CHANGES' | 'COMMENT' | 'APPROVE';
	comments: ReviewCommentWire[];
	body?: string;
}

export interface PublishParams {
	owner: string;
	repo: string;
	prNumber: number;
	headSha: string;
	result: ReviewResult;
	blockOnIssues?: boolean;
	minSeverity?: string;
}

export function buildReviewPayload(
	findings: Finding[],
	headSha: string,
	options: { blockOnIssues?: boolean } = {}
): ReviewPayload {
	const comments: ReviewCommentWire[] = findings.map((finding) => ({
		path: finding.path,
		line: finding.line,
		side: 'RIGHT',
		body: buildFindingBody(finding),
	}));

	const event: ReviewPayload['event'] =
		options.blockOnIssues === false || comments.length === 0
			? 'COMMENT'
			: 'REQUEST_CHANGES';

	return {
		commit_id: headSha,
		event,
		comments,
	};
}

export async function publishReview(
	octokit: PublisherOctokit,
	params: PublishParams
): Promise<void> {
	const { owner, repo, prNumber, headSha, result } = params;

	if (result.findings.length > 0) {
		const payload = buildReviewPayload(result.findings, headSha, {
			blockOnIssues: params.blockOnIssues,
		});
		await octokit.rest.pulls.createReview({
			owner,
			repo,
			pull_number: prNumber,
			commit_id: payload.commit_id,
			event: payload.event,
			comments: payload.comments.map((c) => ({
				path: c.path,
				line: c.line,
				side: c.side,
				body: c.body,
			})),
		});
	}

	await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: prNumber,
		body: buildSummaryBody(result),
	});
}

/** GitHub Job Summary content (spec §39). */
export function buildJobSummary(input: {
	model?: string;
	durationMs?: number;
	filesReviewed: string[];
	result: Pick<ReviewResult, 'counts' | 'risk'> & {
		findings: unknown[];
	};
}): string {
	const seconds =
		input.durationMs !== undefined
			? `${Math.round(input.durationMs / 1000)}s`
			: 'n/a';
	return [
		'## AI Review V2',
		'',
		`- **Model:** ${input.model ?? 'unknown'}`,
		'- **Detected stack:** see review comment',
		`- **Review duration:** ${seconds}`,
		`- **Files reviewed:** ${input.filesReviewed.length}`,
		`- **Findings:** Critical ${input.result.counts.critical} · High ${input.result.counts.high} · Medium ${input.result.counts.medium} · Low ${input.result.counts.low}`,
	].join('\n');
}
