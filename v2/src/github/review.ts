import type { OctokitLike } from '../context/pr.js';
import { normalizeCommentId } from '../review/dedupe.js';
import type { Finding, ReviewResult } from '../types/finding.js';
import type { ReplyParams, ReplyResult, ReviewReply } from '../types/reply.js';
import { buildFindingBody, buildSummaryBody } from './comments.js';

export { buildFindingBody, buildSummaryBody } from './comments.js';

/** Minimal publisher surface; extends the read shape with write calls. */
export interface PublisherOctokit extends OctokitLike {
	rest: OctokitLike['rest'] & {
		pulls: OctokitLike['rest']['pulls'] & {
			createReview(args: Record<string, unknown>): Promise<{ data: unknown }>;
			createReplyForReviewComment(args: {
				owner: string;
				repo: string;
				pull_number: number;
				comment_id: number;
				body: string;
			}): Promise<{ data: { id: number; html_url: string } }>;
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

/**
 * Body for an inline reply. Wraps the follow-up text and re-appends the
 * finding's ai-review-id marker so duplicate suppression keeps working
 * across the whole thread.
 */
export function buildReplyBody(body: string, finding?: Finding): string {
	const trimmed = body.trim();
	if (!finding) {
		return trimmed;
	}
	return `${trimmed}\n\n<!-- ai-review-id:${normalizeCommentId(finding)} -->`;
}

/**
 * Post an inline reply beneath an existing review comment thread
 * (spec §20 extension). Reply-only: never posts the PR summary.
 */
export async function replyToReviewComment(
	octokit: PublisherOctokit,
	params: ReplyParams
): Promise<ReplyResult> {
	if (!params.body || !params.body.trim()) {
		throw new Error(
			'A non-empty reply body is required to reply to a review comment.'
		);
	}
	if (!Number.isFinite(params.commentId) || params.commentId <= 0) {
		throw new Error('A valid numeric review comment id is required to reply.');
	}

	const { data } = await octokit.rest.pulls.createReplyForReviewComment({
		owner: params.owner,
		repo: params.repo,
		pull_number: params.prNumber,
		comment_id: params.commentId,
		body: buildReplyBody(params.body, params.finding),
	});
	return { id: data.id, html_url: data.html_url };
}

/** Convenience wrapper accepting the ReviewReply shape. */
export async function postReviewReply(
	octokit: PublisherOctokit,
	reply: ReviewReply,
	target: { owner: string; repo: string; prNumber: number }
): Promise<ReplyResult> {
	return replyToReviewComment(octokit, {
		...target,
		commentId: reply.commentId,
		body: reply.body,
		finding: reply.finding,
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
