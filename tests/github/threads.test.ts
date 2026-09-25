import { describe, expect, it, vi } from 'vitest';
import { listReviewThreads } from '../../src/github/threads.js';

describe('listReviewThreads', () => {
	it('uses GraphQL reviewThreads pagination and keeps the root comment author', async () => {
		const graphql = vi
			.fn()
			.mockResolvedValueOnce({
				repository: {
					pullRequest: {
						reviewThreads: {
							nodes: [
								{
									isResolved: true,
									comments: {
										nodes: [
											{
												author: { __typename: 'User', login: 'review-bot' },
												body: 'finding\n\n<!-- ai-review-id:abc123abc123 -->',
											},
										],
									},
								},
							],
							pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
						},
					},
				},
			})
			.mockResolvedValueOnce({
				repository: {
					pullRequest: {
						reviewThreads: {
							nodes: [
								{
									isResolved: false,
									comments: {
										nodes: [
											{
												author: { __typename: 'User', login: 'human' },
												body: 'looks wrong to me',
											},
										],
									},
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});

		const threads = await listReviewThreads(graphql, {
			owner: 'acme',
			repo: 'widget',
			pullNumber: 42,
		});

		expect(graphql).toHaveBeenCalledTimes(2);
		expect(graphql.mock.calls[0][1]).toMatchObject({
			owner: 'acme',
			repo: 'widget',
			number: 42,
			after: null,
		});
		expect(graphql.mock.calls[1][1]).toMatchObject({ after: 'cursor-1' });
		expect(threads).toEqual([
			{
				resolved: true,
				comments: [
					{
						user: { login: 'review-bot' },
						body: 'finding\n\n<!-- ai-review-id:abc123abc123 -->',
					},
				],
			},
			{
				resolved: false,
				comments: [{ user: { login: 'human' }, body: 'looks wrong to me' }],
			},
		]);
	});

	it('rejects malformed responses so approval fails closed', async () => {
		const graphql = vi.fn(async () => ({ repository: { pullRequest: null } }));

		await expect(
			listReviewThreads(graphql, {
				owner: 'acme',
				repo: 'widget',
				pullNumber: 42,
			})
		).rejects.toThrow('GitHub GraphQL reviewThreads response is incomplete');
	});

	it('rejects a thread with incomplete resolution or root-author state', async () => {
		const graphql = vi.fn(async () => ({
			repository: {
				pullRequest: {
					reviewThreads: {
						nodes: [
							{
								isResolved: true,
								comments: { nodes: [{ author: null }] },
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		}));

		await expect(
			listReviewThreads(graphql, {
				owner: 'acme',
				repo: 'widget',
				pullNumber: 42,
			})
		).rejects.toThrow('GitHub GraphQL review thread is incomplete');
	});

	function singleThread(author: unknown) {
		return vi.fn(async () => ({
			repository: {
				pullRequest: {
					reviewThreads: {
						nodes: [
							{
								isResolved: false,
								comments: {
									nodes: [
										{ author, body: '<!-- ai-review-id:abc123abc123 -->' },
									],
								},
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		}));
	}

	it('requests the author type so bot actors can be recognised', async () => {
		const graphql = singleThread({ __typename: 'User', login: 'human' });
		await listReviewThreads(graphql, {
			owner: 'acme',
			repo: 'widget',
			pullNumber: 42,
		});
		expect(graphql.mock.calls[0][0]).toMatch(/author\s*{\s*__typename\s+login/);
	});

	it('normalises a GraphQL bot login to the REST [bot] form', async () => {
		// GraphQL reports the workflow token's actor as `github-actions`; REST
		// (and approval attribution) uses `github-actions[bot]`.
		const threads = await listReviewThreads(
			singleThread({ __typename: 'Bot', login: 'github-actions' }),
			{ owner: 'acme', repo: 'widget', pullNumber: 42 }
		);
		expect(threads[0].comments[0].user?.login).toBe('github-actions[bot]');
	});

	it('does not double-suffix a bot login that already carries [bot]', async () => {
		const threads = await listReviewThreads(
			singleThread({ __typename: 'Bot', login: 'review-app[bot]' }),
			{ owner: 'acme', repo: 'widget', pullNumber: 42 }
		);
		expect(threads[0].comments[0].user?.login).toBe('review-app[bot]');
	});

	it('leaves user logins untouched', async () => {
		const threads = await listReviewThreads(
			singleThread({ __typename: 'User', login: 'github-actions' }),
			{ owner: 'acme', repo: 'widget', pullNumber: 42 }
		);
		expect(threads[0].comments[0].user?.login).toBe('github-actions');
	});

	it('rejects a root author without a type so approval fails closed', async () => {
		await expect(
			listReviewThreads(singleThread({ login: 'github-actions' }), {
				owner: 'acme',
				repo: 'widget',
				pullNumber: 42,
			})
		).rejects.toThrow('GitHub GraphQL review thread is incomplete');
	});
});
