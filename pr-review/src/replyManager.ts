import * as core from '@actions/core';
import type { OctokitType } from './types';

// ============================================================================
// Inline Reply Support
// ============================================================================

/**
 * Post an inline reply beneath an existing review comment thread.
 *
 * Activated only through environment variables (INPUT_REPLY_TO_COMMENT_ID
 * + INPUT_REPLY_BODY) so the public action inputs stay untouched. The
 * comment id is GitHub's numeric review comment id — not the
 * ai-review-id marker embedded in bodies.
 */

export interface ReplyOutcome {
	posted: boolean;
	id?: number;
	html_url?: string;
	reason?: string;
}

export function readReplyRequest(
	getEnv: (name: string) => string | undefined = (name) => process.env[name]
): { commentId: number; body: string } | null {
	const rawId = getEnv('INPUT_REPLY_TO_COMMENT_ID');
	const body = getEnv('INPUT_REPLY_BODY');

	if (!rawId && !body) {
		return null;
	}
	const commentId = Number.parseInt(rawId ?? '', 10);
	if (!Number.isFinite(commentId) || commentId <= 0) {
		core.warning('INPUT_REPLY_TO_COMMENT_ID set but not a valid id; skipping reply.');
		return null;
	}
	if (!body || !body.trim()) {
		core.warning('INPUT_REPLY_BODY set but empty; skipping reply.');
		return null;
	}
	return { commentId, body };
}

export async function replyToReviewComment(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	commentId: number,
	body: string
): Promise<ReplyOutcome> {
	try {
		const { data } = await octokit.rest.pulls.createReplyForReviewComment({
			owner,
			repo,
			pull_number: prNumber,
			comment_id: commentId,
			body,
		});
		core.info(`Posted inline reply to review comment ${commentId}.`);
		return { posted: true, id: data.id, html_url: data.html_url };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		core.warning(`Failed to post inline reply to ${commentId}: ${reason}`);
		return { posted: false, reason };
	}
}

/** Read env-driven reply request and post it if present. Fire-and-forget safe. */
export async function maybePostConfiguredReply(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number
): Promise<ReplyOutcome> {
	const request = readReplyRequest();
	if (!request) {
		return { posted: false, reason: 'no reply configured' };
	}
	return replyToReviewComment(
		octokit,
		owner,
		repo,
		prNumber,
		request.commentId,
		request.body.trim()
	);
}
