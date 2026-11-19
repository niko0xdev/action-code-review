import { describe, expect, it, vi } from 'vitest';
import { buildFindingBody, publishReview } from '../../src/github/review.js';
import { toPublisherOctokit } from '../../src/runners/octokit.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';

const EVENT_ONLY_BODY =
	'Blocking findings remain open on this pull request. See the summary comment for details.';

const finding: Finding = {
	path: 'src/a.ts',
	line: 3,
	severity: 'high',
	category: 'security',
	title: 'Unchecked input reaches the query',
	description: 'The id flows into SQL.',
	impact: 'Data exposure.',
	confidence: 0.9,
};

interface Review {
	id: number;
	state: string;
	commit_id: string;
	body: string;
	user: { login: string };
}

/** A client shaped like @actions/github's Octokit, recording every write. */
function fakeClient(
	reviews: Review[],
	commentsByReview?: Record<
		number,
		Array<{ body: string; user: { login: string } }>
	>
) {
	const createReview = vi.fn(async (_args: Record<string, unknown>) => ({
		data: {},
	}));
	const dismissReview = vi.fn(async (_args: Record<string, unknown>) => ({
		data: {},
	}));
	const page = <T>(items: T[]) =>
		vi.fn(async (args: { page?: number }) => ({
			data: (args.page ?? 1) === 1 ? items : [],
		}));
	const client = {
		rest: {
			pulls: {
				get: vi.fn(async () => ({ data: { head: { sha: 'head' } } })),
				createReview,
				dismissReview,
				createReviewComment: vi.fn(),
				listReviews: page(reviews),
				listCommentsForReview: vi.fn(
					async (args: { page?: number; review_id?: number }) => ({
						data:
							(args.page ?? 1) !== 1
								? []
								: commentsByReview
									? (commentsByReview[args.review_id ?? 0] ?? [])
									: reviews.length > 0
										? [
												{
													body: buildFindingBody(finding),
													user: { login: 'github-actions[bot]' },
												},
											]
										: [],
					})
				),
			},
			issues: {
				listComments: page([]),
				createComment: vi.fn(async () => ({ data: {} })),
				updateComment: vi.fn(),
			},
			repos: { getCollaboratorPermissionLevel: vi.fn() },
			users: {
				getAuthenticated: vi.fn(async () => {
					throw Object.assign(new Error('Resource not accessible'), {
						status: 403,
					});
				}),
			},
		},
		graphql: vi.fn(),
	};
	return { client, createReview, dismissReview };
}

function result(findings: Finding[]): ReviewResult {
	return {
		findings,
		summary: 'Summary.',
		risk: findings.length > 0 ? 'high' : 'low',
		counts: { critical: 0, high: findings.length, medium: 0, low: 0 },
		filesReviewed: ['src/a.ts'],
		reviewStatus: 'complete',
	};
}

const params = (findings: Finding[]) => ({
	owner: 'o',
	repo: 'r',
	prNumber: 1,
	headSha: 'head',
	result: result(findings),
	stickySummary: true,
});

describe('publisher through the real Octokit adapter', () => {
	it('does not repeat REQUEST_CHANGES when the bot already blocks this head', async () => {
		const { client, createReview } = fakeClient([
			{
				id: 1,
				state: 'CHANGES_REQUESTED',
				commit_id: 'head',
				body: EVENT_ONLY_BODY,
				user: { login: 'github-actions[bot]' },
			},
		]);
		await publishReview(toPublisherOctokit(client as never), params([finding]));
		expect(createReview).not.toHaveBeenCalled();
	});

	it('forwards the event-only body when blocking a new head', async () => {
		const { client, createReview } = fakeClient([
			{
				id: 1,
				state: 'CHANGES_REQUESTED',
				commit_id: 'old-head',
				body: EVENT_ONLY_BODY,
				user: { login: 'github-actions[bot]' },
			},
		]);
		await publishReview(toPublisherOctokit(client as never), params([finding]));
		expect(createReview).toHaveBeenCalledTimes(1);
		expect(createReview.mock.calls[0][0]).toMatchObject({
			event: 'REQUEST_CHANGES',
			comments: [],
			body: expect.stringContaining(EVENT_ONLY_BODY),
		});
	});
});

describe('clearing a stale block', () => {
	const bot = { login: 'github-actions[bot]' };
	const ownBlock = (id: number, body = EVENT_ONLY_BODY): Review => ({
		id,
		state: 'CHANGES_REQUESTED',
		commit_id: 'old-head',
		body,
		user: bot,
	});

	it("dismisses the bot's own earlier REQUEST_CHANGES on a complete clean run", async () => {
		const { client, dismissReview, createReview } = fakeClient(
			[ownBlock(1), ownBlock(2, '')],
			{ 2: [{ body: buildFindingBody(finding), user: bot }] }
		);
		await publishReview(toPublisherOctokit(client as never), params([]));
		expect(createReview).not.toHaveBeenCalled();
		expect(dismissReview.mock.calls.map((call) => call[0].review_id)).toEqual([
			1, 2,
		]);
		expect(dismissReview.mock.calls[0][0]).toMatchObject({
			owner: 'o',
			repo: 'r',
			pull_number: 1,
			message: expect.stringContaining('No blocking findings remain'),
		});
	});

	it('leaves reviews by another workflow or a human alone', async () => {
		const { client, dismissReview } = fakeClient(
			[
				ownBlock(3, 'Please fix the build first.'),
				{ ...ownBlock(4), user: { login: 'maintainer' } },
				{ ...ownBlock(5), state: 'COMMENTED' },
			],
			{ 3: [{ body: 'plain comment', user: bot }] }
		);
		await publishReview(toPublisherOctokit(client as never), params([]));
		expect(dismissReview).not.toHaveBeenCalled();
	});

	it('keeps the block when the run is incomplete or still blocking', async () => {
		const incomplete = fakeClient([ownBlock(6)]);
		const run = params([]);
		run.result.reviewStatus = 'incomplete';
		await publishReview(toPublisherOctokit(incomplete.client as never), run);
		expect(incomplete.dismissReview).not.toHaveBeenCalled();

		const blocking = fakeClient([ownBlock(7)]);
		await publishReview(
			toPublisherOctokit(blocking.client as never),
			params([finding])
		);
		expect(blocking.dismissReview).not.toHaveBeenCalled();
	});
});
