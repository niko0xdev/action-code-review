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
										nodes: [{ author: { login: 'review-bot' } }],
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
										nodes: [{ author: { login: 'human' } }],
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
			{ resolved: true, comments: [{ user: { login: 'review-bot' } }] },
			{ resolved: false, comments: [{ user: { login: 'human' } }] },
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
});
