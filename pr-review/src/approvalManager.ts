import * as core from '@actions/core';
import type { OctokitType } from './types';

// ============================================================================
// Approval Logic
// ============================================================================

export async function areAiCommentsResolved(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number,
	aiLogin: string
): Promise<boolean> {
	try {
		const threads = await octokit.paginate(
			'GET /repos/{owner}/{repo}/pulls/{pull_number}/threads',
			{
				owner,
				repo,
				pull_number: prNumber,
			}
		);

		const aiThreads = threads.filter((thread: any) =>
			thread.comments?.some((comment: any) => comment.user?.login === aiLogin)
		);

		if (aiThreads.length === 0) {
			core.info('No AI-generated review threads found; skipping approval.');
			return false;
		}

		const unresolvedThreads = aiThreads.filter(
			(thread: any) => !thread.resolved
		);
		const allResolved = unresolvedThreads.length === 0;

		if (!allResolved) {
			core.info(
				`Found ${unresolvedThreads.length} unresolved AI review threads.`
			);
		}

		return allResolved;
	} catch (error) {
		core.error(`Failed to check review thread resolution status: ${error}`);
		return false;
	}
}

export async function approvePullRequest(
	octokit: OctokitType,
	owner: string,
	repo: string,
	prNumber: number
): Promise<void> {
	try {
		await octokit.rest.pulls.createReview({
			owner,
			repo,
			pull_number: prNumber,
			event: 'APPROVE',
			body: 'All AI-generated review comments have been resolved. Auto-approving PR.',
		});
		core.info('Submitted approval review because AI comments are resolved.');
	} catch (error) {
		core.error(`Failed to submit approval review: ${error}`);
	}
}

