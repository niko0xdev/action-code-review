import type * as github from '@actions/github';
import type { PublisherOctokit } from '../github/review.js';
import { listReviewThreads } from '../github/threads.js';

function recordArgs(args: unknown): Record<string, unknown> {
	if (!args || typeof args !== 'object')
		throw new Error('Invalid request arguments');
	return args as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== 'string') throw new Error(`Missing ${key}`);
	return value;
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
	const value = args[key];
	if (typeof value !== 'number') throw new Error(`Missing ${key}`);
	return value;
}

function repositoryArgs(args: Record<string, unknown>) {
	return {
		owner: requiredString(args, 'owner'),
		repo: requiredString(args, 'repo'),
		pull_number: requiredNumber(args, 'pull_number'),
	};
}

export function toPublisherOctokit(
	client: ReturnType<typeof github.getOctokit>
): PublisherOctokit {
	const pulls = {
		get: (args: unknown) =>
			client.rest.pulls.get(repositoryArgs(recordArgs(args))),
		update: (args: Record<string, unknown>) =>
			client.rest.pulls.update({
				...repositoryArgs(args),
				title: requiredString(args, 'title'),
				body: requiredString(args, 'body'),
			}),
		listFiles: (args: Record<string, unknown>) =>
			client.rest.pulls.listFiles({
				...repositoryArgs(args),
				page: requiredNumber(args, 'page'),
				per_page: requiredNumber(args, 'per_page'),
			}),
		createReview: (args: Record<string, unknown>) => {
			const event = requiredString(args, 'event');
			if (!['REQUEST_CHANGES', 'COMMENT', 'APPROVE'].includes(event))
				throw new Error('Invalid event');
			if (args.comments !== undefined && !Array.isArray(args.comments))
				throw new Error('comments must be array');
			return client.rest.pulls.createReview({
				...repositoryArgs(args),
				commit_id: requiredString(args, 'commit_id'),
				event: event as 'REQUEST_CHANGES' | 'COMMENT' | 'APPROVE',
				comments: args.comments as Array<{
					path: string;
					line?: number;
					body: string;
					side?: string;
				}>,
			});
		},
		createReviewComment: (args: Record<string, unknown>) =>
			client.rest.pulls.createReviewComment({
				...repositoryArgs(args),
				body: requiredString(args, 'body'),
				commit_id: requiredString(args, 'commit_id'),
				path: requiredString(args, 'path'),
				line: requiredNumber(args, 'line'),
				side: (() => {
					const side = requiredString(args, 'side');
					if (side !== 'RIGHT' && side !== 'LEFT')
						throw new Error('Invalid side');
					return side;
				})(),
			}),
		createReplyForReviewComment: (args: {
			owner: string;
			repo: string;
			pull_number: number;
			comment_id: number;
			body: string;
		}) => client.rest.pulls.createReplyForReviewComment(args),
		getReviewComment: (args: Record<string, unknown>) =>
			client.rest.pulls.getReviewComment({
				...repositoryArgs(args),
				comment_id: requiredNumber(args, 'comment_id'),
			}),
		listReviews: async (args: Record<string, unknown>) => {
			const response = await client.rest.pulls.listReviews({
				...repositoryArgs(args),
				page: requiredNumber(args, 'page'),
				per_page: requiredNumber(args, 'per_page'),
			});
			return {
				data: response.data.map((review) => ({
					id: review.id,
					user: review.user ? { login: review.user.login ?? undefined } : null,
				})),
			};
		},
		listCommentsForReview: async (args: Record<string, unknown>) => {
			const response = await client.rest.pulls.listCommentsForReview({
				...repositoryArgs(args),
				review_id: requiredNumber(args, 'review_id'),
				page: requiredNumber(args, 'page'),
				per_page: requiredNumber(args, 'per_page'),
			});
			return {
				data: response.data.map((comment) => ({
					body: comment.body ?? null,
					pull_request_url: comment.pull_request_url ?? null,
					user: comment.user
						? { login: comment.user.login ?? undefined }
						: null,
				})),
			};
		},
		listThreads: async (args: Record<string, unknown>) => {
			return listReviewThreads(
				(query, variables) => client.graphql(query, variables),
				{
					owner: requiredString(args, 'owner'),
					repo: requiredString(args, 'repo'),
					pullNumber: requiredNumber(args, 'pull_number'),
				}
			);
		},
	};
	return {
		rest: {
			pulls,
			repos: {
				getCollaboratorPermissionLevel: (args: Record<string, unknown>) =>
					client.rest.repos.getCollaboratorPermissionLevel({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						username: requiredString(args, 'username'),
					}),
			},
			issues: {
				listComments: (args: Record<string, unknown>) =>
					client.rest.issues.listComments({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						issue_number: requiredNumber(args, 'issue_number'),
						page: requiredNumber(args, 'page'),
						per_page: requiredNumber(args, 'per_page'),
					}),
				updateComment: (args: Record<string, unknown>) =>
					client.rest.issues.updateComment({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						comment_id: requiredNumber(args, 'comment_id'),
						body: requiredString(args, 'body'),
					}),
				createComment: (args: Record<string, unknown>) =>
					client.rest.issues.createComment({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						issue_number: requiredNumber(args, 'issue_number'),
						body: requiredString(args, 'body'),
					}),
			},
			users: {
				getAuthenticated: () => client.rest.users.getAuthenticated(),
			},
		},
		users: { getAuthenticated: () => client.rest.users.getAuthenticated() },
	};
}
