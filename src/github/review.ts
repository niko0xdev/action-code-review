import * as core from '@actions/core';
import type { OctokitLike } from '../context/pr.js';
import { normalizeCommentId } from '../review/dedupe.js';
import { sanitiseVerifyReason } from '../review/verify.js';
import { redactSecrets } from '../security/redaction/redactor.js';
import type {
	ApprovalOutcome,
	Finding,
	ReviewResult,
} from '../types/finding.js';
import type { ReplyParams, ReplyResult } from '../types/reply.js';
import { appendToBuffer, classifyFindings } from './buffer.js';
import {
	buildFindingBody,
	buildSummaryBody,
	describeApproval,
	describeReviewExecution,
	mdSafe,
	stickySummaryMarker,
} from './comments.js';
import { hasWritePermission } from './permissions.js';

/** The hidden ledger payload in the sticky summary comment. */
const LEDGER_MARKER = /<!--\s*ai-review-ledger:([A-Za-z0-9+/=]+)\s*-->/;

/** The payload as it is written into the comment. */
function ledgerMarker(payload: string): string {
	return `<!-- ai-review-ledger:${payload} -->`;
}

import { renderReviewFeedback, suppressInlineFinding } from './feedback.js';

export { buildFindingBody, buildSummaryBody } from './comments.js';

function isPermissionError(error: unknown): boolean {
	const err = error as {
		status?: number;
		response?: { status?: number };
	};
	if (err?.status === 403 || err?.response?.status === 403) return true;
	const msg = error instanceof Error ? error.message : String(error);
	return msg.includes('Resource not accessible by integration');
}

interface ReviewRecord {
	id: number;
	state?: string | null;
	commit_id?: string | null;
	body?: string | null;
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
			dismissReview?: (
				args: Record<string, unknown>
			) => Promise<{ data: unknown }>;
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
			compareCommits?: (args: Record<string, unknown>) => Promise<{
				data: {
					status?: string;
					files?: Array<{ filename?: string }>;
				};
			}>;
			listThreads?: (args: {
				owner: string;
				repo: string;
				pull_number: number;
			}) => Promise<
				Array<{
					resolved?: boolean;
					comments?: Array<{
						user?: { login?: string } | null;
						body?: string | null;
					}>;
				}>
			>;
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
		checks?: {
			create(args: Record<string, unknown>): Promise<{ data: { id: number } }>;
			update?(args: Record<string, unknown>): Promise<{ data: unknown }>;
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
	/** Files the review accepted for analysis (post-filter scope). */
	filesSelected?: number;
	/**
	 * Changed files the configured filters kept but the review never saw
	 * (`max-files` cap, no patch from GitHub, or a default-ignored path such as
	 * `dist/`). Any such file blocks auto-approval.
	 */
	filesUnreviewed?: number;
	requireWritePermissions?: boolean;
	actor?: string;
	bufferInlineComments?: boolean;
	stickySummary?: boolean;
	/**
	 * Approve only when the review is complete, at least one AI-authored
	 * thread exists, every such thread is resolved, and no findings were
	 * dropped by `min-severity`. Defaults to false; opt in explicitly.
	 */
	autoApproveWhenResolved?: boolean;
	/** Create the opt-in check run on the reviewed head. */
	checkRun?: boolean;
	/**
	 * The review was incomplete, as the step itself judged it. Undefined falls
	 * back to the publisher's own notion, so a direct call keeps working.
	 */
	incomplete?: boolean;
	/**
	 * Whether an incomplete review fails the step. When false the check is
	 * neutral, mirroring the step that only warns.
	 */
	failOnIncomplete?: boolean;
	/** Add a collapsed "Prompt for your coding agent" block to each inline comment. */
	fixPrompts?: boolean;
	suppressFeedbackInline?: boolean;
	/** Re-read PR head before publishing when the Octokit adapter supports it. */
	recheckHead?: boolean;
}

export function buildReviewPayload(
	findings: Finding[],
	headSha: string,
	options: { blockOnIssues?: boolean; fixPrompts?: boolean } = {}
): ReviewPayload {
	const comments = findings.map((finding) => ({
		path: finding.path,
		line: finding.line,
		side: 'RIGHT' as const,
		body: buildFindingBody(finding, { fixPrompt: options.fixPrompts }),
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

/**
 * Body of a review that only carries the REQUEST_CHANGES event. Re-runs
 * recognise their own earlier event by this fixed prefix, so keep it stable
 * (reviews already posted carry the text without the hidden marker).
 */
const EVENT_ONLY_BODY =
	'Blocking findings remain open on this pull request. See the summary comment for details.';
const EVENT_ONLY_MARKER = '<!-- ai-review-event -->';
const eventOnlyBody = `${EVENT_ONLY_BODY}\n\n${EVENT_ONLY_MARKER}`;

export async function publishReview(
	octokit: PublisherOctokit,
	params: PublishParams
): Promise<void> {
	const { owner, repo, prNumber, headSha, result } = params;
	if (
		params.recheckHead !== false &&
		typeof octokit.rest.pulls.get === 'function'
	) {
		try {
			const current = await octokit.rest.pulls.get({
				owner,
				repo,
				pull_number: prNumber,
			});
			if (current.data.head.sha !== headSha) {
				result.reviewStatus = 'stale';
				core.warning(
					`[review] PR head changed during review (${headSha} -> ${current.data.head.sha}); skipped publishing stale findings.`
				);
				// A required check must never hang: report the skip on the reviewed
				// head. Never on the new head: this late neutral check would replace
				// the newer run's check of the same name, failing one included.
				if (params.checkRun)
					await publishSkipCheckRun(octokit, {
						owner,
						repo,
						headSha,
						reason: 'the pull request head changed during the review',
					});
				return;
			}
		} catch (error) {
			core.warning(
				`[review] Could not recheck PR head; refusing to publish: ${redactDetail(error)}`
			);
			result.reviewStatus = 'stale';
			if (params.checkRun)
				await publishSkipCheckRun(octokit, {
					owner,
					repo,
					headSha,
					reason: 'the pull request head could not be rechecked',
				});
			return;
		}
	}
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
	// The blocking decision covers every valid finding, including those already
	// commented on a previous run: a re-run must not silently drop the
	// REQUEST_CHANGES state just because nothing new needs posting.
	const freshFindings = result.findings.filter(
		(finding) => !existingIds.has(normalizeCommentId(finding))
	);
	let findingsToPublish: Finding[] = freshFindings;
	let validFindings: Finding[] = result.findings;
	if (params.bufferInlineComments) {
		const buffered = freshFindings.map(
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
		const probeIds = new Set(
			(probe as unknown as Finding[]).map((f) => normalizeCommentId(f))
		);
		validFindings = result.findings.filter(
			(f) => !probeIds.has(normalizeCommentId(f))
		);
	}
	// Blocking is decided on every valid finding: the probe filter above only
	// decides what is posted, never whether the review blocks.
	const hasBlockingFinding = result.findings.some(
		(finding) => finding.severity !== 'low'
	);
	// Honor the frozen block-on-issues contract: when the caller turns
	// blocking off, findings are posted as plain COMMENTs instead of
	// REQUEST_CHANGES (docs/v1-interface-contract.md).
	const shouldBlock =
		params.blockOnIssues !== false && hasWrite && hasBlockingFinding;
	// A re-run with nothing new to post must not add another body-only
	// REQUEST_CHANGES to the timeline when the bot's latest review already
	// requests changes on this exact head.
	const alreadyCommented = validFindings.length - findingsToPublish.length;
	const feedback = result.feedback;
	let suppressed = 0;
	// Omitting a new thread could otherwise make the later live resolution
	// check approve when the unfiltered publication would leave it unresolved.
	if (
		params.suppressFeedbackInline &&
		!params.autoApproveWhenResolved &&
		feedback
	) {
		const before = findingsToPublish.length;
		findingsToPublish = findingsToPublish.filter(
			(finding) => !suppressInlineFinding(finding, feedback)
		);
		suppressed = before - findingsToPublish.length;
	}
	const alreadyBlockingOnHead =
		findingsToPublish.length === 0 &&
		shouldBlock &&
		(await hasCurrentBlockingReview(octokit, owner, repo, prNumber, headSha));
	if ((findingsToPublish.length > 0 || shouldBlock) && !alreadyBlockingOnHead) {
		const payload = buildReviewPayload(findingsToPublish, headSha, {
			blockOnIssues: shouldBlock,
			fixPrompts: params.fixPrompts,
		});
		const event = shouldBlock ? 'REQUEST_CHANGES' : 'COMMENT';
		// GitHub requires a body when a review carries no inline comments.
		try {
			await octokit.rest.pulls.createReview({
				owner,
				repo,
				pull_number: prNumber,
				commit_id: payload.commit_id,
				event,
				comments: payload.comments,
				...(payload.comments.length === 0 ? { body: eventOnlyBody } : {}),
			});
		} catch (error) {
			core.warning(`Batch review failed: ${redactDetail(error)}`);
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
						body: `## Review for ${redactSecrets(comment.path)}\n\n**Line ${comment.line}:** ${comment.body}`,
					});
				}
			}
			// The review event must survive the per-comment fallback.
			if (shouldBlock) {
				try {
					await octokit.rest.pulls.createReview({
						owner,
						repo,
						pull_number: prNumber,
						commit_id: headSha,
						event,
						comments: [],
						body: eventOnlyBody,
					});
				} catch (eventError) {
					core.warning(
						`Could not submit ${event} review after fallback: ${redactDetail(eventError)}`
					);
				}
			}
		}
	}
	// A complete run with nothing blocking must also lift the bot's own earlier
	// REQUEST_CHANGES: a later COMMENT does not clear it, and the PR would stay
	// blocked until a human dismissed it.
	if (!hasBlockingFinding && !reviewFailed(result)) {
		await dismissOwnBlockingReviews(octokit, owner, repo, prNumber);
	}
	// Resolve the approval before rendering anything: the summary must report
	// the outcome that actually happened, not "not requested" because the
	// decision had not been made yet.
	result.approval = await resolveApproval(octokit, params, {
		hasWrite,
		hasBlockingFinding,
	});
	// Before the summary comment, so a failure to post it cannot leave a
	// required check unreported.
	if (params.checkRun) {
		await publishCheckRun(octokit, params, validFindings, {
			blocking: shouldBlock,
		});
	}
	const alreadyCommentedNote =
		alreadyCommented > 0
			? `\n\n> ${alreadyCommented} finding(s) already commented on earlier runs; not posted again.`
			: '';
	const marker = stickySummaryMarker(owner, repo, prNumber);
	const summaryOptions = {
		risk: result.risk,
		counts: result.counts,
		filesReviewed: result.filesReviewed,
		summary: result.summary,
		findings: validFindings,
		model: params.model,
		durationMs: params.durationMs,
		filesTotal: params.filesTotal,
		filesExcluded: params.filesExcluded,
		filesSelected: params.filesSelected,
		filesTruncated: result.filesTruncated,
		toolFindings: result.toolFindings,
		diagnostics: result.diagnostics,
		ruleCoverage: result.ruleCoverage,
		reviewStatus: result.reviewStatus,
		linkedIssues: result.linkedIssues,
		feedback,
		approval: result.approval,
	};
	const suffix = `${alreadyCommentedNote}${suppressed ? `\n\n> ${suppressed} finding(s) omitted inline by repository feedback; retained in this review.` : ''}\n\n${marker}`;
	let summaryBody = `${buildSummaryBody(summaryOptions)}${suffix}`;
	if (result.linkedIssues?.length && summaryBody.length > 65_536) {
		summaryBody = `${buildSummaryBody({ ...summaryOptions, linkedIssues: undefined })}${suffix}`;
	}
	if (params.stickySummary) {
		// The ledger travels in the sticky comment, so the next run can read it.
		const ledgerPayload = result.ledger?.payload;
		const summaryWithLedger = ledgerPayload
			? `${summaryBody}\n\n${ledgerMarker(ledgerPayload)}`
			: summaryBody;
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
				body: summaryWithLedger,
			});
		} else {
			await octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: prNumber,
				body: summaryWithLedger,
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
}

const CHECK_RUN_NAME = 'AI Code Review';
/** GitHub accepts at most 50 annotations per create or update request. */
const ANNOTATIONS_PER_REQUEST = 50;
const CHECK_SUMMARY_MAX_CHARS = 20_000;
const CHECK_SUMMARY_MAX_FINDINGS = 50;
const ANNOTATION_LEVEL: Record<string, 'failure' | 'warning' | 'notice'> = {
	critical: 'failure',
	high: 'failure',
	medium: 'warning',
	low: 'notice',
};

function cap(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Opt-in check run on the reviewed head. Its conclusion mirrors the review
 * decision so branch protection can require it. Best effort: a Checks API
 * error (usually a missing `checks: write`) only logs a warning and never
 * changes the review outcome.
 */
async function publishCheckRun(
	octokit: PublisherOctokit,
	params: PublishParams,
	findings: Finding[],
	state: { blocking: boolean }
): Promise<void> {
	const { owner, repo, headSha, result } = params;
	// The step's own judgement of incompleteness wins, so the check and the
	// step never disagree; without it the publisher's notion is used.
	const incomplete = params.incomplete ?? reviewFailed(result);
	const failOnIncomplete = params.failOnIncomplete !== false;
	const conclusion = incomplete
		? failOnIncomplete
			? 'failure'
			: 'neutral'
		: state.blocking
			? 'failure'
			: findings.length > 0
				? 'neutral'
				: 'success';
	const title =
		conclusion === 'failure'
			? incomplete
				? 'Review incomplete'
				: `${findings.length} finding(s), changes requested`
			: conclusion === 'neutral'
				? incomplete
					? 'Review incomplete (the step only warns)'
					: findings.length === 0
						? 'No findings'
						: `${findings.length} finding(s), non-blocking`
				: 'No findings';
	const count = (severity: string) =>
		findings.filter((finding) => finding.severity === severity).length;
	const lines = findings.slice(0, CHECK_SUMMARY_MAX_FINDINGS).map(
		(finding) =>
			// Redact before escaping: escaping first turns quotes into
			// entities, which stops the quote-based secret detectors.
			`- **${finding.severity.toUpperCase()}** \`${mdSafe(redactSecrets(finding.path))}:${finding.line}\` ${mdSafe(redactSecrets(finding.title))}`
	);
	const summary = cap(
		redactSecrets(
			[
				`**Review status:** ${result.reviewStatus ?? 'complete'}${incomplete ? ' (incomplete or failed)' : ''}`,
				`**Risk:** ${result.risk}`,
				'',
				'| Critical | High | Medium | Low |',
				'|---|---|---|---|',
				`| ${count('critical')} | ${count('high')} | ${count('medium')} | ${count('low')} |`,
				...(lines.length > 0 ? ['', ...lines] : []),
				...(findings.length > lines.length
					? [
							'',
							`${findings.length - lines.length} more finding(s) in the annotations.`,
						]
					: []),
			].join('\n')
		),
		CHECK_SUMMARY_MAX_CHARS
	);
	const annotations = findings.map((finding) => ({
		path: finding.path,
		start_line: finding.line,
		end_line: finding.line,
		annotation_level: ANNOTATION_LEVEL[finding.severity] ?? 'notice',
		title: cap(
			redactSecrets(`[${finding.severity.toUpperCase()}] ${finding.title}`),
			255
		),
		message: cap(redactSecrets(finding.description || finding.title), 2000),
	}));
	let created: { data: { id: number } };
	const checks = octokit.rest.checks;
	try {
		if (!checks) throw new Error('Checks API is not available');
		created = await checks.create({
			owner,
			repo,
			name: CHECK_RUN_NAME,
			head_sha: headSha,
			status: 'completed',
			conclusion,
			output: {
				title,
				summary,
				annotations: annotations.slice(0, ANNOTATIONS_PER_REQUEST),
			},
		});
	} catch (error) {
		core.warning(checkRunWarning(error, 'publish'));
		return;
	}
	try {
		for (
			let start = ANNOTATIONS_PER_REQUEST;
			start < annotations.length;
			start += ANNOTATIONS_PER_REQUEST
		) {
			if (!checks.update) throw new Error('checks.update is not available');
			await checks.update({
				owner,
				repo,
				check_run_id: created.data.id,
				output: {
					title,
					summary,
					annotations: annotations.slice(
						start,
						start + ANNOTATIONS_PER_REQUEST
					),
				},
			});
		}
	} catch (error) {
		core.warning(
			checkRunWarning(
				error,
				'finish',
				'Check run created with its conclusion, annotations partially published (a later batch failed)'
			)
		);
	}
}

/** A Checks API failure, worded by what the status actually means. */
function checkRunWarning(error: unknown, phase: string, note?: string): string {
	const status = (error as { status?: number } | undefined)?.status;
	const detail = `${redactDetail(error)}${note ? `. ${note}` : ''}`;
	if (status === 403 || status === 404)
		return `[check-run] Could not ${phase} the "${CHECK_RUN_NAME}" check run: ${detail}. Grant \`checks: write\` in the workflow permissions; a pull request from a fork has a read-only token and cannot create checks. The review itself is unaffected.`;
	if (status === 422)
		return `[check-run] Could not ${phase} the "${CHECK_RUN_NAME}" check run: ${detail}. GitHub rejected the request (an annotation path or line may be outside the commit). The review itself is unaffected.`;
	return `[check-run] Could not ${phase} the "${CHECK_RUN_NAME}" check run: ${detail}. The review itself is unaffected.`;
}

/**
 * Report a completed, neutral check for a run that did not review anything
 * (a draft, an empty file selection, a head that moved). A required check
 * must never be left unreported, or branch protection waits forever.
 */
export async function publishSkipCheckRun(
	octokit: PublisherOctokit,
	params: { owner: string; repo: string; headSha: string; reason: string }
): Promise<void> {
	const { owner, repo, headSha, reason } = params;
	const checks = octokit.rest.checks;
	if (!checks) return;
	try {
		await checks.create({
			owner,
			repo,
			name: CHECK_RUN_NAME,
			head_sha: headSha,
			status: 'completed',
			conclusion: 'neutral',
			output: {
				title: `Skipped: ${reason}`,
				summary: `The review did not run: ${reason}. No findings were produced, and no approval was submitted.`,
				annotations: [],
			},
		});
	} catch (error) {
		core.warning(checkRunWarning(error, 'publish'));
	}
}

/**
 * True when GitHub rejected the review because repository policy forbids
 * GitHub Actions from approving pull requests. This is a repository setting
 * (`can_approve_pull_request_reviews`), not a defect in the review, and it
 * needs a message that tells the operator exactly what to enable.
 */
export function isApprovalNotPermitted(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const status = (error as { status?: number } | undefined)?.status;
	return (
		/GitHub Actions is not permitted to approve/i.test(message) ||
		(status === 422 && /not permitted to approve/i.test(message)) ||
		(status === 403 && /not permitted to approve/i.test(message))
	);
}

function redactDetail(error: unknown): string {
	return redactSecrets(error instanceof Error ? error.message : String(error))
		.replaceAll(/[\r\n]+/g, ' ')
		.slice(0, 300);
}

async function resolveApproval(
	octokit: PublisherOctokit,
	params: PublishParams,
	state: { hasWrite: boolean; hasBlockingFinding: boolean }
): Promise<ApprovalOutcome> {
	if (params.autoApproveWhenResolved !== true)
		return { state: 'not-requested' };
	if (params.requireWritePermissions && !state.hasWrite)
		return { state: 'skipped-no-write-permission' };
	if (state.hasBlockingFinding || reviewFailed(params.result))
		return { state: 'not-requested' };
	if ((params.result.diagnostics?.findingsDroppedBySeverity ?? 0) > 0)
		return {
			state: 'not-requested',
			detail: 'findings below min-severity were dropped',
		};
	// A file nobody reviewed is a bigger blind spot than a dropped finding.
	if ((params.filesUnreviewed ?? 0) > 0)
		return {
			state: 'not-requested',
			detail: `${params.filesUnreviewed} changed file(s) were not reviewed`,
		};
	// A finding with an unknown category was lowered to `low`; its real
	// severity is unknown, so it must not lead to an approval.
	if ((params.result.diagnostics?.bucketedUnknownCategories ?? 0) > 0)
		return {
			state: 'not-requested',
			detail: 'a finding had an unknown category and was lowered to low',
		};
	const threads = await areAiThreadsResolved(
		octokit,
		params.owner,
		params.repo,
		params.prNumber
	);
	if (threads === 'none')
		return {
			state: 'skipped-unresolved-threads',
			detail: 'no prior AI thread',
		};
	if (threads !== 'resolved') return { state: 'skipped-unresolved-threads' };
	try {
		await octokit.rest.pulls.createReview({
			owner: params.owner,
			repo: params.repo,
			pull_number: params.prNumber,
			commit_id: params.headSha,
			event: 'APPROVE',
			body: 'All AI-generated review comments have been resolved. Auto-approving PR.',
		});
		return { state: 'approved' };
	} catch (error) {
		const detail = redactDetail(error);
		if (isApprovalNotPermitted(error)) {
			core.warning(
				`[review] GitHub refused the approval review: ${detail} — enable "Allow GitHub Actions to create and approve pull requests" in repository Actions settings to allow it.`
			);
			return { state: 'not-permitted', detail };
		}
		core.warning(`Approve review failed: ${detail}`);
		return { state: 'failed', detail };
	}
}

/**
 * True when the review pipeline reported failed harness groups. A failed
 * group means part of the PR was never reviewed, so the result is not a
 * clean bill of health.
 */
function reviewFailed(result: PublishParams['result']): boolean {
	return (
		(result.reviewStatus !== undefined && result.reviewStatus !== 'complete') ||
		(result.diagnostics?.failedGroups ?? 0) > 0 ||
		result.filesTruncated === true
	);
}

/**
 * Resolve whether every AI-authored review thread on the PR is resolved.
 * Same semantics as the retired V1 approvalManager.areAiCommentsResolved;
 * uses the structural PublisherOctokit so tests stay transport-agnostic.
 * Fails closed: unknown/errored state, or no AI thread at all, is never
 * "resolved".
 */
async function areAiThreadsResolved(
	octokit: PublisherOctokit,
	_owner: string,
	_repo: string,
	prNumber: number
): Promise<'resolved' | 'none' | 'unresolved'> {
	const listThreads = octokit.rest.pulls.listThreads;
	if (!listThreads) return 'unresolved';
	try {
		const threads = await listThreads({
			owner: _owner,
			repo: _repo,
			pull_number: prNumber,
		});
		// Attribution is marker-first because a workflow GITHUB_TOKEN cannot
		// call `GET /user`: identity lookups return 403, and failing closed on
		// that blocked every approval. When a login *is* resolvable (a PAT
		// caller) the author is checked too, so a marker pasted by another
		// author cannot masquerade as this action's thread. No AI-authored
		// thread means nothing is left to resolve.
		const selfLogin = await resolveSelfLogin(octokit);
		if (!selfLogin)
			core.info(
				'[review] cannot resolve own login (GET /user refused for GITHUB_TOKEN); attributing AI threads by marker on bot-authored comments only.'
			);
		const aiThreads = (threads ?? []).filter((thread) =>
			(thread.comments ?? []).some(
				(comment) =>
					isOwnCommentBody(comment.body) &&
					isTrustedAuthor(comment.user?.login, selfLogin)
			)
		);
		// `[].every(...)` is vacuously true; with no prior AI thread there is
		// nothing a human resolved, so never present that as an approval.
		if (aiThreads.length === 0) return 'none';
		return aiThreads.every((thread) => thread.resolved === true)
			? 'resolved'
			: 'unresolved';
	} catch (error) {
		core.warning(
			`[review] thread resolution check failed: ${error instanceof Error ? error.message : String(error)}`
		);
		return 'unresolved';
	}
}

/**
 * Best-effort authenticated login. A workflow `GITHUB_TOKEN` is refused on
 * `GET /user` (403 Resource not accessible by integration), in which case this
 * returns null and marker-based attribution is used on its own.
 */
export async function resolveSelfLogin(
	octokit: PublisherOctokit
): Promise<string | null> {
	const getAuthenticated =
		octokit.users?.getAuthenticated ?? octokit.rest.users?.getAuthenticated;
	if (!getAuthenticated) return null;
	try {
		const { data } = await getAuthenticated();
		return data?.login ?? null;
	} catch {
		return null;
	}
}

/**
 * True when a comment body carries one of this action's hidden markers.
 * `ai-review-id:` marks an inline finding; `ai-review-summary:` marks the
 * sticky summary. Both are written only by this action.
 */
/**
 * Match the authenticated publisher. When GET /user refuses a workflow token,
 * only the standard Actions publisher is trusted, rather than every bot.
 */
export function isTrustedAuthor(
	login: string | null | undefined,
	selfLogin: string | null
): boolean {
	if (!login) return false;
	if (selfLogin) return login === selfLogin;
	return login === 'github-actions[bot]';
}

export function isOwnCommentBody(body: string | null | undefined): boolean {
	if (!body) return false;
	return (
		body.includes('<!-- ai-review-id:') ||
		body.includes('<!-- ai-review-summary:')
	);
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
		// A marker match is only trusted when the comment is authored by this
		// token. A workflow GITHUB_TOKEN cannot resolve its own login
		// (`GET /user` is refused), so an unverifiable candidate is ignored
		// rather than adopted: updating another author's comment fails, and
		// treating it as ours would let any commenter redirect the summary.
		// Posting a fresh summary is the safe outcome in that case.
		const selfLogin = await resolveSelfLogin(octokit);
		if (!selfLogin)
			core.info(
				'[review] cannot resolve own login (GET /user refused for GITHUB_TOKEN); trusting the marker on bot-authored comments only.'
			);
		for (const comment of comments) {
			if (typeof comment.body !== 'string' || !comment.body.includes(marker))
				continue;
			if (isTrustedAuthor(comment.user?.login, selfLogin)) return comment.id;
		}
	} catch {}
	return null;
}

/**
 * The ledger stored in the sticky summary comment of a previous run, if any.
 * The comment is only read when it carries this action's marker and is
 * authored by this token, so another comment cannot steer the review.
 */
export async function readStoredLedger(
	octokit: PublisherOctokit,
	owner: string,
	repo: string,
	prNumber: number
): Promise<string | undefined> {
	const listComments = octokit.rest.issues.listComments as
		| ((args: Record<string, unknown>) => Promise<{ data: unknown }>)
		| undefined;
	if (!listComments) return undefined;
	const marker = stickySummaryMarker(owner, repo, prNumber);
	try {
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
		const selfLogin = await resolveSelfLogin(octokit);
		for (const comment of comments) {
			if (typeof comment.body !== 'string') continue;
			if (!comment.body.includes(marker)) continue;
			if (!isTrustedAuthor(comment.user?.login, selfLogin)) continue;
			const match = LEDGER_MARKER.exec(comment.body);
			if (match) return match[1];
		}
	} catch {}
	return undefined;
}

/**
 * True when this action's latest submitted review is CHANGES_REQUESTED and
 * was made on `headSha`. Any lookup failure returns false so the event is
 * still submitted (the safe direction).
 */
async function hasCurrentBlockingReview(
	octokit: PublisherOctokit,
	owner: string,
	repo: string,
	prNumber: number,
	headSha: string
): Promise<boolean> {
	if (!octokit.rest.pulls.listReviews) return false;
	try {
		const reviews = await listAll(octokit.rest.pulls.listReviews, {
			owner,
			repo,
			pull_number: prNumber,
		});
		const selfLogin = await resolveSelfLogin(octokit);
		// With a resolved login the author is exact. Without one (a workflow
		// GITHUB_TOKEN is refused on GET /user) accept only `github-actions[bot]`
		// whose body is the action's own event-only text: another review bot
		// must never be mistaken for this action.
		const own = reviews.filter(
			(review) =>
				review.state !== 'PENDING' &&
				(selfLogin
					? review.user?.login === selfLogin
					: review.user?.login === 'github-actions[bot]' &&
						(review.body ?? '').startsWith(EVENT_ONLY_BODY))
		);
		const latest = own[own.length - 1];
		return (
			latest?.state === 'CHANGES_REQUESTED' && latest.commit_id === headSha
		);
	} catch {
		return false;
	}
}

const DISMISS_MESSAGE =
	'No blocking findings remain on the latest complete AI review.';

/**
 * Dismiss every CHANGES_REQUESTED review this action submitted. Authorship is
 * exact when the token's login resolves; otherwise only `github-actions[bot]`
 * reviews that carry this action's event-only body or an inline finding
 * marker count, so another workflow's review is never touched. Failures are
 * logged and never fail the publish.
 */
async function dismissOwnBlockingReviews(
	octokit: PublisherOctokit,
	owner: string,
	repo: string,
	prNumber: number
): Promise<void> {
	const { listReviews, listCommentsForReview, dismissReview } =
		octokit.rest.pulls;
	if (!listReviews || !dismissReview) return;
	try {
		const reviews = await listAll(listReviews, {
			owner,
			repo,
			pull_number: prNumber,
		});
		const selfLogin = await resolveSelfLogin(octokit);
		for (const review of reviews) {
			if (review.state !== 'CHANGES_REQUESTED') continue;
			if (!isTrustedAuthor(review.user?.login, selfLogin)) continue;
			if (!selfLogin && !(review.body ?? '').startsWith(EVENT_ONLY_BODY)) {
				if (!listCommentsForReview) continue;
				const comments = await listAll(listCommentsForReview, {
					owner,
					repo,
					pull_number: prNumber,
					review_id: review.id,
				});
				if (!comments.some((comment) => isOwnCommentBody(comment.body)))
					continue;
			}
			await dismissReview({
				owner,
				repo,
				pull_number: prNumber,
				review_id: review.id,
				message: DISMISS_MESSAGE,
			});
			core.info(`[review] Dismissed earlier blocking review ${review.id}.`);
		}
	} catch (error) {
		core.warning(
			`[review] Could not dismiss an earlier blocking review: ${redactDetail(error)}`
		);
	}
}

export async function listAll<T>(
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
		!octokit.rest.pulls.listReviews ||
		!octokit.rest.pulls.listCommentsForReview
	)
		return ids;
	try {
		const reviews = await listAll(octokit.rest.pulls.listReviews, {
			owner,
			repo,
			pull_number: prNumber,
		});
		const selfLogin = await resolveSelfLogin(octokit);
		for (const review of reviews) {
			const comments = await listAll(octokit.rest.pulls.listCommentsForReview, {
				owner,
				repo,
				pull_number: prNumber,
				review_id: review.id,
				per_page: 100,
			});
			for (const comment of comments) {
				if (!isTrustedAuthor(comment.user?.login, selfLogin)) continue;
				// The action writes its marker last, so the last match is the real
				// one; an earlier one could only come from quoted finding text.
				const match = [
					...(comment.body ?? '').matchAll(
						/<!-- ai-review-id:([a-f0-9]{12}) -->/g
					),
				].at(-1);
				if (match) ids.add(match[1]);
			}
		}
	} catch (error) {
		if (isPermissionError(error)) {
			core.info(
				'Skipping duplicate check — missing pull-requests: write permission. ' +
					'Add `permissions: { contents: read, pull-requests: write }` to the workflow, ' +
					'or ensure the token has PR write access. For fork PRs, GITHUB_TOKEN is read-only.'
			);
		} else {
			core.warning(
				`Failed to fetch existing review comments: ${error instanceof Error ? error.message : String(error)}`
			);
		}
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

export function buildJobSummary(input: {
	model?: string;
	durationMs?: number;
	filesReviewed: string[];
	filesTotal?: number;
	filesExcluded?: number;
	/** Files the review accepted for analysis (post-filter scope). */
	filesSelected?: number;
	result: Pick<ReviewResult, 'counts' | 'risk'> & {
		findings: unknown[];
		reviewStatus?: ReviewResult['reviewStatus'];
		approval?: ReviewResult['approval'];
		feedback?: ReviewResult['feedback'];
	};
	toolFindings?: ReviewResult['toolFindings'];
	diagnostics?: ReviewResult['diagnostics'];
}): string {
	const seconds =
		input.durationMs !== undefined
			? `${Math.round(input.durationMs / 1000)}s`
			: 'n/a';
	const reviewed = input.filesReviewed.length;
	const excluded =
		input.filesExcluded ??
		Math.max((input.filesTotal ?? reviewed) - reviewed, 0);
	const total = input.filesTotal ?? reviewed + excluded;
	const filesLine =
		input.filesTotal !== undefined || input.filesExcluded !== undefined
			? `**Files reviewed:** ${reviewed} of ${total} (${excluded} excluded by filter)`
			: `**Files reviewed:** ${reviewed}`;
	const lines: string[] = [
		'## AI Review',
		'',
		'- **Detected stack:** see review comment',
		`- **Review duration:** ${seconds}`,
		`- ${filesLine}`,
		...(input.diagnostics?.reviewEffort
			? [`- **Review effort:** ${input.diagnostics.reviewEffort}`]
			: []),
		`- ${describeReviewExecution({
			risk: input.result.risk,
			counts: input.result.counts,
			filesReviewed: input.filesReviewed,
			filesTotal: input.filesTotal,
			filesExcluded: input.filesExcluded,
			filesSelected: input.filesSelected,
			diagnostics: input.diagnostics,
			reviewStatus: input.result.reviewStatus,
		})}`,
		`- ${describeApproval(input.result.approval)}`,
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
	if (input.result.feedback)
		lines.push('', renderReviewFeedback(input.result.feedback));
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
		if (
			diagnostics.verifyVerified !== undefined ||
			diagnostics.verifyDropped !== undefined
		) {
			diagLines.push(
				`- **Verify pass:** kept ${diagnostics.verifyVerified ?? 0}, dropped ${diagnostics.verifyDropped ?? 0}${diagnostics.verifyCostUsd !== undefined ? ` ($${diagnostics.verifyCostUsd.toFixed(3)} est.)` : ''}`
			);
		}
		if (diagnostics.verifySkippedReason !== undefined) {
			diagLines.push(
				`- **Verify pass:** skipped (${sanitiseVerifyReason(diagnostics.verifySkippedReason)})`
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
				`- [${finding.tool}/${finding.code}] \`${redactSecrets(finding.path)}:${finding.line}\` (${finding.severity}) ${redactSecrets(finding.message)}`
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
