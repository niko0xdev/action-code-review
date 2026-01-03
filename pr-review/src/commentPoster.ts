import * as core from '@actions/core';
import type { ReviewComment } from './reviewParser';
import type { ReviewOptions } from './types';
import type { OctokitType } from './types';

// ============================================================================
// Constants
// ============================================================================

const REVIEW_ID_MARKER_PATTERN = /<!-- ai-review-id:([a-f0-9]{12}) -->/;

// ============================================================================
// Duplicate Detection & Comment Posting
// ============================================================================

async function fetchExistingCommentIds(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number
): Promise<Set<string>> {
	const existingCommentIds = new Set<string>();

	try {
		const authenticatedLogin = await getAuthenticatedLogin(octokit);
		if (!authenticatedLogin) {
			core.info(
				'Unable to determine authenticated user; skipping duplicate check.'
			);
			return existingCommentIds;
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
					existingCommentIds.add(idMatch[1]);
				}
			}
		}

		core.info(`Found ${existingCommentIds.size} existing AI review comments`);
	} catch (error) {
		core.warning(`Failed to fetch existing comments: ${error}`);
	}

	return existingCommentIds;
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

export function filterDuplicateComments(
	comments: ReviewComment[],
	existingIds: Set<string>
): { newComments: ReviewComment[]; duplicateCount: number } {
	const newComments = comments.filter(
		(comment) => !existingIds.has(comment.id)
	);
	const duplicateCount = comments.length - newComments.length;

	if (duplicateCount > 0) {
		core.info(
			`Skipping ${duplicateCount} duplicate comment(s) that already exist`
		);
	}

	return { newComments, duplicateCount };
}

export function appendCommentId(comment: ReviewComment): string {
	const marker = `<!-- ai-review-id:${comment.id} -->`;

	if (comment.body.includes('<!-- ai-review-id:')) {
		return comment.body;
	}

	return `${comment.body}\n\n${marker}`.trim();
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
	const existingCommentIds = await fetchExistingCommentIds(
		octokit,
		options.owner,
		options.repo,
		options.prNumber
	);

	const { newComments, duplicateCount } = filterDuplicateComments(
		comments,
		existingCommentIds
	);

	if (newComments.length === 0) {
		core.info('No new comments to post (all are duplicates)');
		return;
	}

	const commentsByFile = groupCommentsByFile(newComments);

	for (const [filename, fileComments] of Object.entries(commentsByFile)) {
		const reviewComments = fileComments.map((comment) => ({
			body: appendCommentId(comment),
			path: comment.path,
			line: comment.line ?? 1,
			side: 'RIGHT' as const,
			commit_id: commitId,
		}));

		await postReviewForFile(
			octokit,
			options.owner,
			options.repo,
			options.prNumber,
			filename,
			reviewComments,
			options.reviewEvent
		);
	}

	core.info(
		`Posted ${newComments.length} new comments to PR with event: ${options.reviewEvent}`
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
		commit_id: string;
	}>,
	reviewEvent: 'COMMENT' | 'REQUEST_CHANGES'
): Promise<void> {
	try {
		await octokit.rest.pulls.createReview({
			owner,
			repo,
			pull_number: prNumber,
			comments: reviewComments,
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
		commit_id: string;
	}>
): Promise<void> {
	for (const reviewComment of reviewComments) {
		try {
			await octokit.rest.pulls.createReviewComment({
				owner,
				repo,
				pull_number: prNumber,
				body: reviewComment.body,
				commit_id: reviewComment.commit_id,
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
