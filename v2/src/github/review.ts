import * as core from '@actions/core';
import type { OctokitLike } from '../context/pr.js';
import { normalizeCommentId } from '../review/dedupe.js';
import type { Finding, ReviewResult } from '../types/finding.js';
import type { ReplyParams, ReplyResult, ReviewReply } from '../types/reply.js';
import { appendToBuffer, classifyFindings } from './buffer.js';
import {
	buildFindingBody,
	buildSummaryBody,
	stickySummaryMarker,
} from './comments.js';
import { hasWritePermission } from './permissions.js';

export { buildFindingBody, buildSummaryBody } from './comments.js';

interface ReviewRecord {
	id: number;
	user?: { login?: string } | null;
}
interface ReviewCommentRecord {
	body?: string | null;
	pull_request_url?: string | null;
	user?: { login?: string } | null;
}

export interface PublisherOctokit extends OctokitLike {
	rest: OctokitLike['rest'] & {
		pulls: OctokitLike['rest']['pulls'] & {
			update(args: Record<string, unknown>): Promise<{ data: unknown }>;
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
			getReviewComment(
				args: Record<string, unknown>
			): Promise<{ data: ReviewCommentRecord }>;
			listReviews?: (
				args: Record<string, unknown>
			) => Promise<{ data: ReviewRecord[] }>;
			listCommentsForReview?: (
				args: Record<string, unknown>
			) => Promise<{ data: ReviewCommentRecord[] }>;
		};
		repos?: {
			getCollaboratorPermissionLevel(args: {
				owner: string;
				repo: string;
				username: string;
			}): Promise<{ data: { permission: string } }>;
		};
		issues: {
			createComment(args: Record<string, unknown>): Promise<{ data: unknown }>;
			listComments?(args: Record<string, unknown>): Promise<{
				data: Array<{
					id: number;
					body?: string | null;
					user?: { login?: string } | null;
				}>;
			}>;
			updateComment?(args: Record<string, unknown>): Promise<{ data: unknown }>;
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
	model?: string;
	durationMs?: number;
	filesTotal?: number;
	filesExcluded?: number;
	requireWritePermissions?: boolean;
	actor?: string;
	bufferInlineComments?: boolean;
	stickySummary?: boolean;
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
	let hasWrite = true;
	if (params.requireWritePermissions && params.actor) {
		hasWrite = await hasWritePermission(octokit, owner, repo, params.actor);
		if (!hasWrite) {
			core.warning(
				`[review] Actor ${params.actor} lacks write permission — skipping APPROVE/REQUEST_CHANGES escalation (review still posted).`
			);
		}
	}
	const existingIds = await fetchExistingCommentIds(
		octokit,
		owner,
		repo,
		prNumber
	);
	const findings = result.findings.filter(
		(finding) => !existingIds.has(normalizeCommentId(finding))
	);
	const hasBlockingFinding = findings.some(
		(finding) => finding.severity !== 'low'
	);
	let findingsToPublish: Finding[] = findings;
	if (params.bufferInlineComments) {
		const buffered = findings.map(
			(f) =>
				({ ...f, ts: new Date().toISOString() }) as unknown as import(
					'./buffer.js'
				).BufferedFinding
		);
		try {
			appendToBuffer(buffered);
		} catch {}
		const { real, probe } = classifyFindings(buffered);
		if (probe.length > 0) {
			core.warning(
				`[buffer] ${probe.length} finding(s) filtered as test/probe — NOT posted`
			);
		}
		findingsToPublish = real as unknown as Finding[];
	}
	if (findingsToPublish.length > 0) {
		const payload = buildReviewPayload(findingsToPublish, headSha, {
			blockOnIssues: hasBlockingFinding,
		});
		try {
			await octokit.rest.pulls.createReview({
				owner,
				repo,
				pull_number: prNumber,
				commit_id: payload.commit_id,
				event: hasBlockingFinding ? 'REQUEST_CHANGES' : 'COMMENT',
				comments: payload.comments,
			});
		} catch (error) {
			core.warning(
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
	const marker = stickySummaryMarker(owner, repo, prNumber);
	const summaryBody = `${buildSummaryBody({
		risk: result.risk,
		counts: result.counts,
		filesReviewed: result.filesReviewed,
		summary: result.summary,
		findings,
		model: params.model,
		durationMs: params.durationMs,
		filesTotal: params.filesTotal,
		filesExcluded: params.filesExcluded,
		toolFindings: result.toolFindings,
		diagnostics: result.diagnostics,
	})}\n\n${marker}`;
	if (params.stickySummary) {
		const existing = await findStickyComment(
			octokit,
			owner,
			repo,
			prNumber,
			marker
		);
		if (existing) {
			await octokit.rest.issues.updateComment?.({
				owner,
				repo,
				comment_id: existing,
				body: summaryBody,
			});
		} else {
			await octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: prNumber,
				body: summaryBody,
			});
		}
	} else {
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: prNumber,
			body: summaryBody,
		});
	}
	if (hasWrite && (findings.length === 0 || !hasBlockingFinding)) {
		try {
			await octokit.rest.pulls.createReview({
				owner,
				repo,
				pull_number: prNumber,
				commit_id: headSha,
				event: 'APPROVE',
				body: '✅ AI Code Review: no blocking issues found. Auto-approving.',
			});
		} catch (error) {
			core.warning(
				`Approve review failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}

async function findStickyComment(
	octokit: PublisherOctokit,
	owner: string,
	repo: string,
	prNumber: number,
	marker: string
): Promise<number | null> {
	const listComments = octokit.rest.issues.listComments as
		| ((args: Record<string, unknown>) => Promise<{ data: unknown }>)
		| undefined;
	if (!listComments) return null;
	try {
		const auth = octokit.users
			? await octokit.users.getAuthenticated().catch(() => null)
			: null;
		const selfLogin = auth?.data?.login;
		const comments = await listAll(
			listComments as (args: Record<string, unknown>) => Promise<{
				data: Array<{
					id: number;
					body?: string | null;
					user?: { login?: string } | null;
				}>;
			}>,
			{ owner, repo, issue_number: prNumber }
		);
		for (const c of comments as Array<{
			id: number;
			body?: string | null;
			user?: { login?: string } | null;
		}>) {
			if (
				selfLogin &&
				(c as { user?: { login?: string } | null }).user?.login !== selfLogin
			)
				continue;
			if (typeof c.body === 'string' && c.body.includes(marker)) return c.id;
		}
	} catch {}
	return null;
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
		core.warning(
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
	const { data: target } = await octokit.rest.pulls.getReviewComment({
		owner: params.owner,
		repo: params.repo,
		pull_number: params.prNumber,
		comment_id: params.commentId,
	});
	const expectedUrl = `repos/${params.owner}/${params.repo}/pulls/${params.prNumber}`;
	const targetBody = target.body ?? '';
	const getAuthenticated =
		octokit.users?.getAuthenticated ?? octokit.rest.users?.getAuthenticated;
	const auth = getAuthenticated ? (await getAuthenticated()).data.login : '';
	if (
		!target.pull_request_url?.endsWith(expectedUrl) ||
		!targetBody.includes('<!-- ai-review-id:') ||
		!target.user?.login ||
		target.user.login !== auth
	)
		throw new Error('Review comment target failed trust validation.');
	if (
		params.finding &&
		!targetBody.includes(normalizeCommentId(params.finding))
	)
		throw new Error('Review comment target does not match finding identity.');
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
	toolFindings?: ReviewResult['toolFindings'];
	diagnostics?: ReviewResult['diagnostics'];
}): string {
	const seconds =
		input.durationMs !== undefined
			? `${Math.round(input.durationMs / 1000)}s`
			: 'n/a';
	const lines: string[] = [
		'## AI Review V2',
		'',
		'- **Detected stack:** see review comment',
		`- **Review duration:** ${seconds}`,
		`- **Files reviewed:** ${input.filesReviewed.length}`,
		`- **Findings:** Critical ${input.result.counts.critical} · High ${input.result.counts.high} · Medium ${input.result.counts.medium} · Low ${input.result.counts.low}`,
	];
	// Q3 decision: surface tool findings + diagnostics in a collapsible
	// section so users can verify what static analyzers ran and what
	// they caught. Always rendered (collapsed by default) so the
	// summary stays compact in the headline view.
	if (
		(input.toolFindings && input.toolFindings.length > 0) ||
		input.diagnostics
	) {
		lines.push('');
		lines.push(
			renderToolFindingsSection(input.toolFindings, input.diagnostics)
		);
	}
	return lines.join('\n');
}

/**
 * Render the collapsible diagnostics block (tool findings + pipeline
 * metadata). Mirrors how CodeRabbit / PR-Agent show tool output:
 * always present, collapsed by default in GitHub's `<details>` widget.
 */
export function renderToolFindingsSection(
	toolFindings: ReviewResult['toolFindings'],
	diagnostics: ReviewResult['diagnostics']
): string {
	const summaryLabel = diagnostics?.prelintRan?.length
		? `Tool findings (${diagnostics.prelintRan.join(', ')})`
		: 'Tool findings';
	const lines: string[] = [`<details><summary>${summaryLabel}</summary>`, ''];
	if (diagnostics) {
		const diagLines: string[] = [];
		if (diagnostics.prelintRan?.length) {
			diagLines.push(`- **Tools ran:** ${diagnostics.prelintRan.join(', ')}`);
		}
		if (diagnostics.prelintSkipped?.length) {
			diagLines.push(
				`- **Tools skipped:** ${diagnostics.prelintSkipped.join(', ')}`
			);
		}
		if (diagnostics.toolFindingsTotal !== undefined) {
			diagLines.push(
				`- **Tool findings total:** ${diagnostics.toolFindingsTotal}`
			);
		}
		if (diagnostics.bucketedUnknownCategories !== undefined) {
			diagLines.push(
				`- **Bucketed (unknown category -> low):** ${diagnostics.bucketedUnknownCategories}`
			);
		}
		if (diagnostics.crossFindingConflictsResolved !== undefined) {
			diagLines.push(
				`- **Cross-finding conflicts resolved:** ${diagnostics.crossFindingConflictsResolved}`
			);
		}
		if (diagnostics.trivialPrFastPath !== undefined) {
			diagLines.push(
				`- **Trivial-PR fast path:** ${diagnostics.trivialPrFastPath ? 'yes' : 'no'}`
			);
		}
		if (diagLines.length > 0) {
			lines.push('### Pipeline diagnostics', '');
			lines.push(...diagLines);
			lines.push('');
		}
	}
	if (toolFindings && toolFindings.length > 0) {
		lines.push('### Static analyzer findings', '');
		const top = toolFindings.slice(0, 20);
		for (const finding of top) {
			lines.push(
				`- [${finding.tool}/${finding.code}] \`${finding.path}:${finding.line}\` (${finding.severity}) ${finding.message}`
			);
		}
		if (toolFindings.length > top.length) {
			lines.push(`- ... and ${toolFindings.length - top.length} more`);
		}
		lines.push('');
	}
	lines.push('</details>');
	return lines.join('\n');
}
