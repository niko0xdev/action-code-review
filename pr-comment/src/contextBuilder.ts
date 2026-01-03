import * as core from '@actions/core';
import type { OctokitType } from './types';
import type { CommentContext, ContextOptions } from './types';
import {
	extractAiReviewId,
	isAiComment,
} from './commentListener';

// ============================================================================
// Context Building Functions
// ============================================================================

/**
 * Fetch the parent comment for a given comment ID
 */
async function fetchParentComment(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	commentId: number
): Promise<{ id: number; body: string; userLogin: string } | null> {
	try {
		// Try to fetch as issue comment
		const { data: comment } = await octokit.rest.issues.getComment({
			owner,
			repo,
			comment_id: commentId,
		});

		return {
			id: comment.id,
			body: comment.body || '',
			userLogin: comment.user?.login || '',
		};
	} catch (error) {
		core.warning(`Failed to fetch parent comment ${commentId}: ${error}`);
		return null;
	}
}

/**
 * Fetch review thread comments for a PR
 */
async function fetchReviewThreadComments(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number
): Promise<Array<{ id: number; body: string; path?: string; line?: number }>> {
	try {
		const { data: reviews } = await octokit.rest.pulls.listReviews({
			owner,
			repo,
			pull_number: prNumber,
		});

		const comments: Array<{ id: number; body: string; path?: string; line?: number }> = [];

		for (const review of reviews) {
			const { data: reviewComments } =
				await octokit.rest.pulls.listCommentsForReview({
					owner,
					repo,
					pull_number: prNumber,
					review_id: review.id,
				});

			for (const comment of reviewComments) {
				comments.push({
					id: comment.id,
					body: comment.body || '',
					path: comment.path,
					line: comment.line,
				});
			}
		}

		return comments;
	} catch (error) {
		core.warning(`Failed to fetch review comments: ${error}`);
		return [];
	}
}

/**
 * Find the parent AI comment that started the thread
 */
async function findParentAiComment(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	questionCommentId: number
): Promise<{
	id: number;
	body: string;
	userLogin: string;
	aiReviewId: string | null;
	filePath?: string;
	line?: number;
} | null> {
	try {
		// First, try to get the issue comment to check if it has a parent
		const { data: questionComment } = await octokit.rest.issues.getComment({
			owner,
			repo,
			comment_id: questionCommentId,
		});

		// Check if this comment has a parent comment
		if (questionComment.in_reply_to_id) {
			const parentComment = await fetchParentComment(
				octokit,
				owner,
				repo,
				prNumber,
				questionComment.in_reply_to_id
			);

			if (parentComment && isAiComment(parentComment.body)) {
				return {
					id: parentComment.id,
					body: parentComment.body,
					userLogin: parentComment.userLogin,
					aiReviewId: extractAiReviewId(parentComment.body),
				};
			}
		}

		// If no parent or parent is not AI, check review comments
		const reviewComments = await fetchReviewThreadComments(
			octokit,
			owner,
			repo,
			prNumber
		);

		// Find AI comment that could be the parent
		for (const comment of reviewComments) {
			if (isAiComment(comment.body)) {
				return {
					id: comment.id,
					body: comment.body,
					userLogin: '', // Review comments don't always have user
					aiReviewId: extractAiReviewId(comment.body),
					filePath: comment.path,
					line: comment.line,
				};
			}
		}

		return null;
	} catch (error) {
		core.warning(`Failed to find parent AI comment: ${error}`);
		return null;
	}
}

/**
 * Fetch file content from the repository
 */
async function fetchFileContent(
	octokit: OctokitType,
	owner: string,
	repo: string,
	path: string,
	ref: string
): Promise<string | null> {
	try {
		const { data } = await octokit.rest.repos.getContent({
			owner,
			repo,
			path,
			ref,
		});

		if ('content' in data && data.content) {
			return Buffer.from(data.content, 'base64').toString('utf-8');
		}

		return null;
	} catch (error) {
		core.warning(`Failed to fetch file content for ${path}: ${error}`);
		return null;
	}
}

/**
 * Extract relevant code snippet around a line
 */
function extractCodeSnippet(
	content: string,
	lineNumber: number,
	contextLines: number = 5
): string {
	const lines = content.split('\n');
	const start = Math.max(0, lineNumber - contextLines - 1);
	const end = Math.min(lines.length, lineNumber + contextLines);

	return lines.slice(start, end).join('\n');
}

/**
 * Build context for generating a reply
 */
export async function buildContextForReply(
	octokit: OctokitType,
	commentId: number,
	prNumber: number,
	owner: string,
	repo: string,
	headSha: string,
	prTitle: string,
	commentBody: string,
	commentUser: string,
	commentCreatedAt: string,
	options: ContextOptions
): Promise<CommentContext | null> {
	// Find parent AI comment
	const parentAiComment = await findParentAiComment(
		octokit,
		owner,
		repo,
		prNumber,
		commentId
	);

	if (!parentAiComment) {
		core.info('No parent AI comment found, skipping reply');
		return null;
	}

	core.info(
		`Found parent AI comment with ID: ${parentAiComment.id}, AI review ID: ${parentAiComment.aiReviewId}`
	);

	// Build file context if available
	let fileContext;
	if (parentAiComment.filePath && parentAiComment.line) {
		if (options.includeFullContent) {
			const fileContent = await fetchFileContent(
				octokit,
				owner,
				repo,
				parentAiComment.filePath,
				headSha
			);

			if (fileContent) {
				// Truncate if exceeds max context
				let content = fileContent;
				if (content.length > options.maxContextChars) {
					content = content.slice(0, options.maxContextChars);
					core.debug('Truncated file content to fit max context length');
				}

				fileContext = {
					path: parentAiComment.filePath,
					line: parentAiComment.line,
					content,
				};
			}
		} else {
			// Fetch full content but only extract snippet
			const fileContent = await fetchFileContent(
				octokit,
				owner,
				repo,
				parentAiComment.filePath,
				headSha
			);

			if (fileContent) {
				const snippet = extractCodeSnippet(fileContent, parentAiComment.line);
				fileContext = {
					path: parentAiComment.filePath,
					line: parentAiComment.line,
					content: snippet,
				};
			}
		}
	}

	return {
		parentComment: {
			id: parentAiComment.id,
			body: parentAiComment.body,
			userLogin: parentAiComment.userLogin,
			aiReviewId: parentAiComment.aiReviewId,
		},
		questionComment: {
			id: commentId,
			body: commentBody,
			userLogin: commentUser,
			createdAt: commentCreatedAt,
		},
		fileContext,
		prContext: {
			number: prNumber,
			title: prTitle,
			owner,
			repo,
			headSha,
		},
	};
}

/**
 * Create default context options
 */
export function createDefaultContextOptions(
	includeFullContent: boolean = false,
	maxContextChars: number = 10000
): ContextOptions {
	return {
		includeFullContent,
		maxContextChars,
	};
}

