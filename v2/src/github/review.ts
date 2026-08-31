import type { OctokitLike } from '../context/pr.js';
import { normalizeCommentId } from '../review/dedupe.js';
import type { Finding, ReviewResult } from '../types/finding.js';
import type { ReplyParams, ReplyResult, ReviewReply } from '../types/reply.js';
import { buildFindingBody, buildSummaryBody } from './comments.js';

export { buildFindingBody, buildSummaryBody } from './comments.js';

interface ReviewRecord {
	id: number;
	user?: { login?: string } | null;
}
interface ReviewCommentRecord {
	body?: string | null;
}

export interface PublisherOctokit extends OctokitLike {
	rest: OctokitLike['rest'] & {
		pulls: OctokitLike['rest']['pulls'] & {
			createReview(args: Record<string, unknown>): Promise<{ data: unknown }>;
			createReviewComment(
				args: Record<string, unknown>
			): Promise<{ data: unknown }>;
			createReplyForReviewComment(args: {
				owner: string;
				repo: string;
				pull_number: number;
				comment_id: number;
				body: string;
			}): Promise<{ data: { id: number; html_url: string } }>;
			listReviews?: (
				args: Record<string, unknown>
			) => Promise<{ data: ReviewRecord[] }>;
			listCommentsForReview?: (
				args: Record<string, unknown>
			) => Promise<{ data: ReviewCommentRecord[] }>;
		};
		issues: {
			createComment(args: Record<string, unknown>): Promise<{ data: unknown }>;
		};
	};
	users?: { getAuthenticated: () => Promise<{ data: { login: string } }> };
}

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
	const comments = findings.map((finding) => ({
		path: finding.path,
		line: finding.line,
		side: 'RIGHT' as const,
		body: buildFindingBody(finding),
	}));
	return {
		commit_id: headSha,
		event:
			options.blockOnIssues === false || comments.length === 0
				? 'COMMENT'
				: 'REQUEST_CHANGES',
		comments,
	};
}

export async function publishReview(
	octokit: PublisherOctokit,
	params: PublishParams
): Promise<void> {
	const { owner, repo, prNumber, headSha, result } = params;
	const existingIds = await fetchExistingCommentIds(
		octokit,
		owner,
		repo,
		prNumber
	);
	const findings = result.findings.filter(
		(finding) => !existingIds.has(normalizeCommentId(finding))
	);
	if (findings.length > 0) {
		const payload = buildReviewPayload(findings, headSha, {
			blockOnIssues: params.blockOnIssues,
		});
		try {
			await octokit.rest.pulls.createReview({
				owner,
				repo,
				pull_number: prNumber,
				commit_id: payload.commit_id,
				event: payload.event,
				comments: payload.comments,
			});
		} catch (error) {
			console.warn(
				`Batch review failed: ${error instanceof Error ? error.message : String(error)}`
			);
			for (const comment of payload.comments) {
				try {
					await octokit.rest.pulls.createReviewComment({
						owner,
						repo,
						pull_number: prNumber,
						body: comment.body,
						commit_id: headSha,
						path: comment.path,
						line: comment.line,
						side: comment.side,
					});
				} catch {
					await octokit.rest.issues.createComment({
						owner,
						repo,
						issue_number: prNumber,
						body: `## Review for ${comment.path}\n\n**Line ${comment.line}:** ${comment.body}`,
					});
				}
			}
		}
	}
	await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: prNumber,
		body: buildSummaryBody({
			risk: result.risk,
			counts: result.counts,
			filesReviewed: result.filesReviewed,
			summary: result.summary,
		}),
	});
}

async function listAll<T>(
	method:
		| ((args: Record<string, unknown>) => Promise<{ data: T[] }>)
		| undefined,
	args: Record<string, unknown>
): Promise<T[]> {
	if (!method) return [];
	const all: T[] = [];
	for (let page = 1; page <= 10; page += 1) {
		const { data } = await method({ ...args, page, per_page: 100 });
		all.push(...data);
		if (data.length < 100) break;
	}
	return all;
}

async function fetchExistingCommentIds(
	octokit: PublisherOctokit,
	owner: string,
	repo: string,
	prNumber: number
): Promise<Set<string>> {
	const ids = new Set<string>();
	if (
		!octokit.users?.getAuthenticated ||
		!octokit.rest.pulls.listReviews ||
		!octokit.rest.pulls.listCommentsForReview
	)
		return ids;
	try {
		const { data: auth } = await octokit.users.getAuthenticated();
		const reviews = await listAll(octokit.rest.pulls.listReviews, {
			owner,
			repo,
			pull_number: prNumber,
		});
		for (const review of reviews) {
			if (review.user?.login !== auth.login) continue;
			const comments = await listAll(octokit.rest.pulls.listCommentsForReview, {
				owner,
				repo,
				pull_number: prNumber,
				review_id: review.id,
				per_page: 100,
			});
			for (const comment of comments) {
				const match = comment.body?.match(
					/<!-- ai-review-id:([a-f0-9]{12}) -->/
				);
				if (match) ids.add(match[1]);
			}
		}
	} catch (error) {
		console.warn(
			`Failed to fetch existing review comments: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	return ids;
}

export function buildReplyBody(body: string, finding?: Finding): string {
	const trimmed = body.trim();
	return finding
		? `${trimmed}\n\n<!-- ai-review-id:${normalizeCommentId(finding)} -->`
		: trimmed;
}

export async function replyToReviewComment(
	octokit: PublisherOctokit,
	params: ReplyParams
): Promise<ReplyResult> {
	if (!params.body || !params.body.trim())
		throw new Error(
			'A non-empty reply body is required to reply to a review comment.'
		);
	if (!Number.isFinite(params.commentId) || params.commentId <= 0)
		throw new Error('A valid numeric review comment id is required to reply.');
	const { data } = await octokit.rest.pulls.createReplyForReviewComment({
		owner: params.owner,
		repo: params.repo,
		pull_number: params.prNumber,
		comment_id: params.commentId,
		body: buildReplyBody(params.body, params.finding),
	});
	return { id: data.id, html_url: data.html_url };
}

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

export function buildJobSummary(input: {
	model?: string;
	durationMs?: number;
	filesReviewed: string[];
	result: Pick<ReviewResult, 'counts' | 'risk'> & { findings: unknown[] };
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
