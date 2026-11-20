import { describe, expect, it } from 'vitest';
import {
	sampleReviewFeedback,
	suppressInlineFinding,
} from '../../src/github/feedback.js';
import type { PublisherOctokit } from '../../src/github/review.js';
import type { Finding } from '../../src/types/finding.js';

const info = { hasNextPage: false };
const connection = <T>(nodes: T[]) => ({ nodes, pageInfo: info });
const reaction = (login: string, content = 'THUMBS_DOWN', type = 'User') => ({
	user: { login, __typename: type },
	content,
});
const thread = (
	id: number,
	author = 'github-actions',
	reactions = [reaction('writer')]
) => ({
	isResolved: true,
	comments: {
		nodes: [
			{
				author: { login: author, __typename: 'Bot' },
				body: `✅ LOW · Maintainability\n\n<!-- ai-review-id:${id.toString(16).padStart(12, '0')} -->`,
				reactions: connection(reactions),
			},
		],
	},
});
const octokit = (permission?: (username: string) => string) =>
	({
		rest: {
			repos: permission && {
				getCollaboratorPermissionLevel: async ({
					username,
				}: { username: string }) => ({
					data: { permission: permission(username) },
				}),
			},
		},
	}) as unknown as PublisherOctokit;
const sample = (
	threads: ReturnType<typeof thread>[],
	permissions?: (username: string) => string,
	truncated = false
) =>
	sampleReviewFeedback(
		octokit(permissions),
		async () => ({
			repository: {
				pullRequests: {
					nodes: [
						{
							number: 1,
							reviewThreads: {
								...connection(threads),
								pageInfo: { hasNextPage: truncated },
							},
						},
					],
				},
			},
		}),
		{ owner: 'example', repo: 'example', prNumber: 2 }
	);

const finding: Finding = {
	severity: 'low',
	category: 'maintainability',
	confidence: 1,
	path: 'example.ts',
	line: 1,
	title: 'Naming',
	description: 'Use a descriptive name',
	impact: 'Readability',
};

describe('repository review feedback', () => {
	it('counts only explicit votes from verified humans on publisher-owned roots', async () => {
		const result = await sample(
			[
				thread(1, 'other-bot'),
				thread(2, 'github-actions', [
					reaction('writer'),
					reaction('Writer'),
					reaction('reader'),
					reaction('bot', 'THUMBS_DOWN', 'Bot'),
					reaction('conflict'),
					reaction('conflict', 'THUMBS_UP'),
				]),
			],
			(username) => (username === 'reader' ? 'read' : 'write')
		);
		expect(result).toEqual({
			complete: true,
			pullRequests: 1,
			categories: [
				{
					category: 'maintainability',
					findings: 1,
					resolvedThreads: 1,
					positive: 0,
					negative: 1,
					samples: 1,
				},
			],
		});
	});

	it('fails closed for unavailable permission or truncated threads', async () => {
		expect((await sample([thread(1)])).complete).toBe(false);
		expect((await sample([thread(1)], () => 'write', true)).complete).toBe(
			false
		);
	});

	it('requires five distinct voted findings and at least 80% negative votes, and exempts safety categories and blocking severity', async () => {
		const threads = [
			thread(1),
			thread(2),
			thread(3),
			thread(4),
			thread(5, 'github-actions', [reaction('writer', 'THUMBS_UP')]),
		];
		const stats = await sample(threads, () => 'maintain');
		expect(suppressInlineFinding(finding, stats)).toBe(true);
		expect(
			suppressInlineFinding(
				finding,
				await sample(threads.slice(0, 4), () => 'write')
			)
		).toBe(false);
		expect(
			suppressInlineFinding(
				finding,
				await sample(
					[
						...threads,
						thread(6, 'github-actions', [reaction('writer', 'THUMBS_UP')]),
					],
					() => 'write'
				)
			)
		).toBe(false);
		expect(suppressInlineFinding(finding, { ...stats, complete: false })).toBe(
			false
		);
		for (const category of ['security', 'correctness'] as const) {
			expect(
				suppressInlineFinding(
					{ ...finding, category },
					{
						...stats,
						categories: stats.categories.map((row) => ({ ...row, category })),
					}
				)
			).toBe(false);
		}
		expect(
			suppressInlineFinding({ ...finding, severity: 'medium' }, stats)
		).toBe(false);
	});
});
