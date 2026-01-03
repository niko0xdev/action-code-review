import * as github from '@actions/github';

export type OctokitType = ReturnType<typeof github.getOctokit>;

export interface FileData {
	sha: string;
	filename: string;
	status:
		| 'added'
		| 'removed'
		| 'modified'
		| 'renamed'
		| 'copied'
		| 'changed'
		| 'unchanged';
	additions: number;
	deletions: number;
	changes: number;
	blob_url: string;
	raw_url: string;
	contents_url: string;
	patch?: string;
	previous_filename?: string;
}

export interface ReviewOptions {
	owner: string;
	repo: string;
	prNumber: number;
	headSha: string;
	reviewEvent: 'COMMENT' | 'REQUEST_CHANGES';
}

export interface ReviewComment {
	path: string;
	line: number;
	body: string;
	id: string;
}

const REVIEW_ID_MARKER_PATTERN = /<!-- ai-review-id:([a-f0-9]{12}) -->/;

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

export async function fetchExistingCommentIds(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number
): Promise<Set<string>> {
	const existingCommentIds = new Set<string>();

	try {
		const authenticatedLogin = await getAuthenticatedLogin(octokit);
		if (!authenticatedLogin) {
			core.info('Unable to determine authenticated user; skipping duplicate check.');
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

		core.info(
			`Found ${existingCommentIds.size} existing AI review comments`
		);
	} catch (error) {
		core.warning(`Failed to fetch existing comments: ${error}`);
	}

	return existingCommentIds;
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
