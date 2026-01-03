import type { OctokitType } from './types';

/**
 * Update AI review comments based on PR changes
 */
export async function updateCommentsOnPrChange(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	headSha: string
): Promise<void> {
	try {
		// Get all comments on PR
		const { data: comments } = await octokit.rest.issues.listComments({
			owner,
			repo,
			issue_number: prNumber,
		});

		// Filter for bot's comments (assuming they contain "🤖" emoji or have specific pattern)
		const botComments = comments.filter((comment: any) => {
			if (!comment?.body) return false;
			return (
				comment.body.includes('🤖') ||
				comment.body.includes('AI Code Review') ||
				(comment.user?.login && comment.user.login.includes('[bot]'))
			);
		});

		if (botComments.length === 0) {
			console.info('No AI comments to update');
			return;
		}

		console.info(
			`Found ${botComments.length} AI comments to check for updates`
		);

		// Update each comment with a note about PR changes
		for (const comment of botComments) {
			const updatedBody = addReReviewNote(comment.body!);

			if (updatedBody !== comment.body) {
				console.info(`Updating comment ${comment.id}`);

				await octokit.rest.issues.updateComment({
					owner,
					repo,
					comment_id: comment.id,
					body: updatedBody,
				});
			}
		}
	} catch (error) {
		console.error('Error updating comments:', error);
	}
}

/**
 * Add a note to a comment about re-reviewing
 */
function addReReviewNote(commentBody: string): string {
	// Check if comment already has note marker
	if (commentBody.includes('> 📝 **Note**')) {
		return commentBody;
	}

	// Add note that this comment was created before recent changes
	const note = `\n\n---\n\n> 📝 **Note**: This comment was created before recent changes. Please verify if the issue is still applicable.`;

	return commentBody + note;
}
