import * as core from '@actions/core';
import type { OctokitType } from './types';
import type { ReplyOptions } from './types';
import { addReplyMarker } from './prompts';

// ============================================================================
// Constants
// ============================================================================

const MAX_REPLY_ATTEMPTS = 3;

// ============================================================================
// Reply Posting Functions
// ============================================================================

/**
 * Post a reply to a comment on a PR
 */
export async function postReplyToComment(
	octokit: OctokitType,
	options: ReplyOptions,
	replyBody: string
): Promise<void> {
	const { owner, repo, prNumber, parentCommentId } = options;

	const markedReply = addReplyMarker(replyBody);

	let attempt = 0;
	while (attempt < MAX_REPLY_ATTEMPTS) {
		attempt++;
		core.info(
			`Posting reply attempt ${attempt}/${MAX_REPLY_ATTEMPTS} to comment ${parentCommentId}`
		);

		try {
			await octokit.rest.issues.createCommentReply({
				owner,
				repo,
				issue_number: prNumber,
				comment_id: parentCommentId,
				body: markedReply,
			});

			core.info('Successfully posted reply');
			return;
		} catch (error) {
			core.warning(`Attempt ${attempt} failed: ${error}`);

			if (attempt >= MAX_REPLY_ATTEMPTS) {
				core.error('All retry attempts failed');
				throw error;
			}

			// Wait before retry (exponential backoff)
			const waitTime = Math.pow(2, attempt) * 1000;
			core.info(`Waiting ${waitTime}ms before retry...`);
			await new Promise((resolve) => setTimeout(resolve, waitTime));
		}
	}
}

/**
 * Post a reply with fallback to issue comment if thread reply fails
 */
export async function postReplyWithFallback(
	octokit: OctokitType,
	options: ReplyOptions,
	replyBody: string
): Promise<void> {
	try {
		await postReplyToComment(octokit, options, replyBody);
	} catch (error) {
		core.warning(`Failed to post thread reply, trying fallback: ${error}`);

		// Fallback: post as regular issue comment
		try {
			const markedReply = addReplyMarker(replyBody);
			await octokit.rest.issues.createComment({
				owner: options.owner,
				repo: options.repo,
				issue_number: options.prNumber,
				body: markedReply,
			});

			core.info('Successfully posted reply as issue comment (fallback)');
		} catch (fallbackError) {
			core.error(`Fallback also failed: ${fallbackError}`);
			throw new Error(
				`Failed to post reply via both thread and fallback: ${fallbackError}`
			);
		}
	}
}

