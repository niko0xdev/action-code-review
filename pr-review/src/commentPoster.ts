import * as core from '@actions/core';
import type { ReviewComment } from './reviewParser';
import type { ReviewOptions } from './types';
import type { OctokitType } from './types';

// ============================================================================
// Constants
// ============================================================================

const REVIEW_ID_MARKER_PATTERN = /<!-- ai-review-id:([a-f0-9]{12}) -->/;
const REVIEW_LINE_RANGE_PATTERN = /<!-- ai-review-range:(\d+)-(\d+) -->/;

// ============================================================================
// Types
// ============================================================================

interface ExistingReviewComment {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	githubCommentId: number;
	body: string;
}

// ============================================================================
// Duplicate Detection & Comment Posting
// ============================================================================

/**
 * Check if two line ranges overlap
 * Example: [15, 20] overlaps with [14, 21] because max(15, 14) = 15 <= min(20, 21) = 20
 */
export function checkLineOverlap(
	startLine1: number,
	endLine1: number,
	startLine2: number,
	endLine2: number
): boolean {
	return Math.max(startLine1, startLine2) <= Math.min(endLine1, endLine2);
}

/**
 * Find an existing comment that matches the new comment
 * Matches by ID first, then by overlapping line ranges
 */
export function findMatchingComment(
	newComment: ReviewComment,
	existingComments: ExistingReviewComment[]
): ExistingReviewComment | null {
	// First check for exact ID match
	const exactMatch = existingComments.find((ec) => ec.id === newComment.id);
	if (exactMatch) {
		return exactMatch;
	}

	// Then check for overlapping line ranges in the same file
	for (const existing of existingComments) {
		if (
			existing.path === newComment.path &&
			checkLineOverlap(
				existing.startLine,
				existing.endLine,
				newComment.startLine,
				newComment.endLine
			)
		) {
			return existing;
		}
	}

	return null;
}

async function fetchExistingComments(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number
): Promise<ExistingReviewComment[]> {
	const existingComments: ExistingReviewComment[] = [];

	try {
		const authenticatedLogin = await getAuthenticatedLogin(octokit);
		if (!authenticatedLogin) {
			core.info(
				'Unable to determine authenticated user; skipping duplicate check.'
			);
			return existingComments;
		}

		const { data: reviews } = await octokit.rest.pulls.listReviews({
			owner,
			repo,
			pull_number: prNumber,
		});

		for (const review of reviews) {
			if (review.user?.login !== authenticatedLogin) continue;

			const { data: reviewComments } =
				await octokit.rest.pulls.listCommentsForReview({
					owner,
					repo,
					pull_number: prNumber,
					review_id: review.id,
				});

			for (const comment of reviewComments) {
				const idMatch = comment.body?.match(REVIEW_ID_MARKER_PATTERN);
				if (idMatch) {
					// Extract line range from comment body
					const rangeMatch = comment.body?.match(
						REVIEW_LINE_RANGE_PATTERN
					);
					let startLine = comment.line ?? 1;
					let endLine = comment.line ?? 1;

					if (rangeMatch) {
						startLine = Number.parseInt(rangeMatch[1]);
						endLine = Number.parseInt(rangeMatch[2]);
					}

					existingComments.push({
						id: idMatch[1],
						path: comment.path || '',
						startLine,
						endLine,
						githubCommentId: comment.id,
						body: comment.body || '',
					});
				}
			}
		}

		core.info(
			`Found ${existingComments.length} existing AI review comments`
		);
	} catch (error) {
		core.warning(`Failed to fetch existing comments: ${error}`);
	}

	return existingComments;
}

export async function getAuthenticatedLogin(
	octokit: OctokitType
): Promise<string | null> {
	try {
		const { data } = await octokit.rest.users.getAuthenticated();
		return data.login;
	} catch (error) {
		core.error(`Failed to fetch authenticated user: ${error}`);
		return null;
	}
}

/**
 * Update an existing review comment's body
 */
async function updateCommentBody(
	octokit: OctokitType,
	owner: string,
	repo: string,
	commentId: number,
	newBody: string
): Promise<void> {
	try {
		await octokit.rest.pulls.updateReviewComment({
			owner,
			repo,
			comment_id: commentId,
			body: newBody,
		});
		core.info(`Updated comment ${commentId}`);
	} catch (error) {
		core.error(`Failed to update comment ${commentId}: ${error}`);
		throw error;
	}
}

export function appendCommentId(comment: ReviewComment): string {
	const idMarker = `<!-- ai-review-id:${comment.id} -->`;
	const rangeMarker = `<!-- ai-review-range:${comment.startLine}-${comment.endLine} -->`;

	// Check if comment already has markers
	if (comment.body.includes('<!-- ai-review-id:')) {
		return comment.body;
	}

	return `${comment.body}\n\n${rangeMarker}\n${idMarker}`.trim();
}

export function groupCommentsByFile(
	comments: ReviewComment[]
): Record<string, ReviewComment[]> {
	return comments.reduce(
		(acc, comment) => {
			if (!acc[comment.path]) {
				acc[comment.path] = [];
			}
			acc[comment.path].push(comment);
			return acc;
		},
		{} as Record<string, ReviewComment[]>
	);
}

export async function postCommentsToPR(
	octokit: OctokitType,
	comments: ReviewComment[],
	commitId: string,
	options: ReviewOptions
): Promise<void> {
	const existingComments = await fetchExistingComments(
		octokit,
		options.owner,
		options.repo,
		options.prNumber
	);

	const commentsToUpdate: Array<{
		existing: ExistingReviewComment;
		new: ReviewComment;
	}> = [];
	const commentsToCreate: ReviewComment[] = [];

	// Separate comments to update vs create
	for (const comment of comments) {
		const matchingComment = findMatchingComment(comment, existingComments);
		if (matchingComment) {
			commentsToUpdate.push({
				existing: matchingComment,
				new: comment,
			});
		} else {
			commentsToCreate.push(comment);
		}
	}

	// Update existing comments
	let updateCount = 0;
	for (const { existing, new: newComment } of commentsToUpdate) {
		try {
			const updatedBody = appendCommentId(newComment);
			await updateCommentBody(
				octokit,
				options.owner,
				options.repo,
				existing.githubCommentId,
				updatedBody
			);
			updateCount++;
		} catch (error) {
			core.error(`Failed to update comment, will create new one: ${error}`);
			commentsToCreate.push(newComment);
		}
	}

	// Create new comments
	if (commentsToCreate.length === 0 && updateCount === 0) {
		core.info('No comments to post or update');
		return;
	}

	const commentsByFile = groupCommentsByFile(commentsToCreate);

	for (const [filename, fileComments] of Object.entries(commentsByFile)) {
		// FIXED: Remove commit_id from individual comments
		// commit_id should only be at review level, not in each comment
		const reviewComments = fileComments.map((comment) => ({
			body: appendCommentId(comment),
			path: comment.path,
			line: comment.line,
			side: 'RIGHT' as const,
			// ❌ REMOVED: commit_id is not valid for inline comments
		}));

		await postReviewForFile(
			octokit,
			options.owner,
			options.repo,
			options.prNumber,
			filename,
			reviewComments,
			commitId,  // ✅ Pass commit_id at review level instead
			options.reviewEvent
		);
	}

	core.info(
		`Updated ${updateCount} comment(s) and posted ${commentsToCreate.length} new comment(s) to PR with event: ${options.reviewEvent}`
	);
}

// ============================================================================
// Comment Posting Helpers
// ============================================================================

async function postReviewForFile(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	filename: string,
	reviewComments: Array<{
		body: string;
		path: string;
		line: number;
		side: 'RIGHT';
	}>,
	commitId: string,  // ✅ NEW PARAM: commit_id at review level
	reviewEvent: 'COMMENT' | 'REQUEST_CHANGES'
): Promise<void> {
	try {
		await octokit.rest.pulls.createReview({
			owner,
			repo,
			pull_number: prNumber,
			comments: reviewComments,
			commit_id: commitId,  // ✅ Pass commit_id at review level, not per-comment
			event: reviewEvent,
		});
	} catch (error) {
		core.error(`Failed to post comments for ${filename}: ${error}`);
		await postFallbackComments(
			octokit,
			owner,
			repo,
			prNumber,
			filename,
			reviewComments
		);
	}
}

async function postFallbackComments(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	filename: string,
	reviewComments: Array<{
		body: string;
		path: string;
		line: number;
		side: 'RIGHT';
	}>,
	commitId?: string  // ✅ NEW PARAM: Optional commit_id for fallback
): Promise<void> {
	for (const reviewComment of reviewComments) {
		try {
			await octokit.rest.pulls.createReviewComment({
				owner,
				repo,
				pull_number: prNumber,
				body: reviewComment.body,
				commit_id: commitId,  // ✅ Pass commit_id if provided (optional)
				path: reviewComment.path,
				side: reviewComment.side,
				line: reviewComment.line,
			});
		} catch (commentError) {
			core.error(
				`Failed to post individual comment for ${filename}: ${commentError}`
			);
			await postIssueCommentFallback(
				octokit,
				owner,
				repo,
				prNumber,
				filename,
				reviewComment
			);
		}
	}
}

async function postIssueCommentFallback(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	filename: string,
	reviewComment: { body: string; line: number }
): Promise<void> {
	await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: prNumber,
		body: `## 📝 Review for ${filename}\n\n**Line ${reviewComment.line}:** ${reviewComment.body}`,
	});
}
