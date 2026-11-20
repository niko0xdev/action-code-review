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
			repos: {
				getCollaboratorPermissionLevel: vi.fn(async () => ({
					data: { permission: 'write' },
				})),
			},
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
	const createCheck = vi.fn(async (_args: Record<string, unknown>) => ({
		data: { id: 42 },
	}));
	const updateCheck = vi.fn(async (_args: Record<string, unknown>) => ({
		data: {},
	}));
	Object.assign(client.rest, {
		checks: { create: createCheck, update: updateCheck },
	});
	return { client, createReview, dismissReview, createCheck, updateCheck };
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

describe('opt-in check run', () => {
	const checkParams = (findings: Finding[]) => ({
		...params(findings),
		checkRun: true,
	});
	const output = (call: unknown[]) =>
		(call[0] as { output: Record<string, unknown> }).output as {
			title: string;
			summary: string;
			annotations: Array<Record<string, unknown>>;
		};

	it('fails the check when the review blocks and annotates the finding', async () => {
		const { client, createCheck } = fakeClient([]);
		await publishReview(
			toPublisherOctokit(client as never),
			checkParams([finding])
		);
		expect(createCheck).toHaveBeenCalledTimes(1);
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			owner: 'o',
			repo: 'r',
			name: 'AI Code Review',
			head_sha: 'head',
			status: 'completed',
			conclusion: 'failure',
		});
		expect(output(createCheck.mock.calls[0]).annotations).toEqual([
			expect.objectContaining({
				path: 'src/a.ts',
				start_line: 3,
				end_line: 3,
				annotation_level: 'failure',
			}),
		]);
	});

	it('succeeds on a clean complete review', async () => {
		const { client, createCheck } = fakeClient([]);
		await publishReview(toPublisherOctokit(client as never), checkParams([]));
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			conclusion: 'success',
		});
		expect(output(createCheck.mock.calls[0]).annotations).toEqual([]);
	});

	it('is neutral when the findings do not block', async () => {
		const low = fakeClient([]);
		await publishReview(
			toPublisherOctokit(low.client as never),
			checkParams([{ ...finding, severity: 'low' }])
		);
		expect(low.createCheck.mock.calls[0][0]).toMatchObject({
			conclusion: 'neutral',
		});
		expect(output(low.createCheck.mock.calls[0]).annotations[0]).toMatchObject({
			annotation_level: 'notice',
		});

		const unblocked = fakeClient([]);
		await publishReview(toPublisherOctokit(unblocked.client as never), {
			...checkParams([{ ...finding, severity: 'medium' }]),
			blockOnIssues: false,
		});
		expect(unblocked.createCheck.mock.calls[0][0]).toMatchObject({
			conclusion: 'neutral',
		});
		expect(
			output(unblocked.createCheck.mock.calls[0]).annotations[0]
		).toMatchObject({ annotation_level: 'warning' });
	});

	it('fails the check when the review is incomplete', async () => {
		const { client, createCheck } = fakeClient([]);
		const run = checkParams([]);
		run.result.reviewStatus = 'incomplete';
		await publishReview(toPublisherOctokit(client as never), run);
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			conclusion: 'failure',
		});
	});

	it('sends 50 annotations with create and the rest in batches of 50', async () => {
		const { client, createCheck, updateCheck } = fakeClient([]);
		const many = Array.from({ length: 120 }, (_, i) => ({
			...finding,
			line: i + 1,
			title: `Finding ${i + 1}`,
		}));
		await publishReview(toPublisherOctokit(client as never), checkParams(many));
		expect(createCheck).toHaveBeenCalledTimes(1);
		expect(updateCheck).toHaveBeenCalledTimes(2);
		expect(output(createCheck.mock.calls[0]).annotations).toHaveLength(50);
		expect(
			updateCheck.mock.calls.map((call) => output(call).annotations.length)
		).toEqual([50, 20]);
		expect(updateCheck.mock.calls[0][0]).toMatchObject({
			owner: 'o',
			repo: 'r',
			check_run_id: 42,
		});
		expect(output(updateCheck.mock.calls[1]).annotations[19]).toMatchObject({
			start_line: 120,
		});
	});

	it('redacts secrets in annotation titles and the summary', async () => {
		const token = ['gh', 'p_', 'Zq8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue'].join('');
		const { client, createCheck } = fakeClient([]);
		await publishReview(
			toPublisherOctokit(client as never),
			checkParams([
				{
					...finding,
					title: `Token ${token} is hard-coded`,
					description: `Remove ${token}.`,
				},
			])
		);
		const sent = JSON.stringify(createCheck.mock.calls[0][0]);
		expect(sent).not.toContain(token);
		expect(output(createCheck.mock.calls[0]).annotations[0].title).toContain(
			'Token'
		);
	});

	it('warns and still publishes the review when the Checks API refuses', async () => {
		const { client, createReview } = fakeClient([]);
		const createCheck = vi.fn(async () => {
			throw Object.assign(new Error('Resource not accessible by integration'), {
				status: 403,
			});
		});
		Object.assign(client.rest, { checks: { create: createCheck } });
		const warn = vi.fn();
		const coreMod = await import('@actions/core');
		const spy = vi.spyOn(coreMod, 'warning').mockImplementation(warn);
		try {
			await expect(
				publishReview(
					toPublisherOctokit(client as never),
					checkParams([finding])
				)
			).resolves.toBeUndefined();
		} finally {
			spy.mockRestore();
		}
		expect(createCheck).toHaveBeenCalledTimes(1);
		expect(createReview).toHaveBeenCalledTimes(1);
		expect(client.rest.issues.createComment).toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('checks: write'));
	});

	it('reports a neutral check on the reviewed head when the head recheck fails', async () => {
		const { client, createCheck } = fakeClient([]);
		client.rest.pulls.get = vi.fn(async () => {
			throw new Error('boom');
		});
		const spy = vi
			.spyOn(await import('@actions/core'), 'warning')
			.mockImplementation(() => {});
		await publishReview(
			toPublisherOctokit(client as never),
			checkParams([finding])
		);
		spy.mockRestore();
		expect(createCheck).toHaveBeenCalledTimes(1);
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			head_sha: 'head',
			conclusion: 'neutral',
		});
	});

	it('still creates the check when posting the summary comment throws', async () => {
		const { client, createCheck } = fakeClient([]);
		client.rest.issues.createComment = vi.fn(async () => {
			throw new Error('summary post failed');
		});
		await expect(
			publishReview(toPublisherOctokit(client as never), checkParams([finding]))
		).rejects.toThrow('summary post failed');
		expect(createCheck).toHaveBeenCalledTimes(1);
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			conclusion: 'failure',
		});
	});

	it('says the annotations were partially published when a later update fails', async () => {
		const { client, createCheck, updateCheck } = fakeClient([]);
		updateCheck.mockRejectedValueOnce(
			Object.assign(new Error('Validation Failed'), { status: 422 })
		);
		const many = Array.from({ length: 60 }, (_, i) => ({
			...finding,
			line: i + 1,
			title: `Finding ${i + 1}`,
		}));
		const warn = vi.fn();
		const coreMod = await import('@actions/core');
		const spy = vi.spyOn(coreMod, 'warning').mockImplementation(warn);
		try {
			await publishReview(
				toPublisherOctokit(client as never),
				checkParams(many)
			);
		} finally {
			spy.mockRestore();
		}
		expect(createCheck).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('annotations partially published')
		);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('GitHub rejected the request')
		);
	});

	it('redacts a quoted secret assignment in a finding title', async () => {
		const { client, createCheck } = fakeClient([]);
		await publishReview(
			toPublisherOctokit(client as never),
			checkParams([
				{
					...finding,
					title: 'Hard-coded password = "S3cr3tP4ssw0rd!x"',
					description: "secret='q8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue'",
				},
			])
		);
		const sent = JSON.stringify(createCheck.mock.calls[0][0]);
		expect(sent).not.toContain('S3cr3tP4ssw0rd');
		expect(sent).not.toContain('q8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue');
	});

	it('does not fail the check when the actor lacks write permission', async () => {
		const { client, createCheck } = fakeClient([]);
		(
			client.rest.repos.getCollaboratorPermissionLevel as ReturnType<
				typeof vi.fn
			>
		).mockResolvedValue({ data: { permission: 'read' } });
		await publishReview(toPublisherOctokit(client as never), {
			...checkParams([finding]),
			requireWritePermissions: true,
			actor: 'outsider',
		});
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			conclusion: 'neutral',
		});
		expect(output(createCheck.mock.calls[0]).title).not.toContain(
			'changes requested'
		);
	});

	it('is neutral, not failed, when incompleteness does not fail the step', async () => {
		const { client, createCheck } = fakeClient([]);
		const run = checkParams([]);
		run.result.reviewStatus = 'incomplete';
		await publishReview(toPublisherOctokit(client as never), {
			...run,
			incomplete: true,
			failOnIncomplete: false,
		});
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			conclusion: 'neutral',
		});
		expect(output(createCheck.mock.calls[0]).title).toContain('incomplete');
	});

	it('reports a neutral check on the reviewed head when the head changed', async () => {
		const { client, createCheck } = fakeClient([]);
		client.rest.pulls.get = vi.fn(async () => ({
			data: { head: { sha: 'newer-head' } },
		}));
		await publishReview(
			toPublisherOctokit(client as never),
			checkParams([finding])
		);
		expect(createCheck).toHaveBeenCalledTimes(1);
		// The reviewed head, never the new one: a late neutral check on the new
		// head would replace the newer run's failing check of the same name.
		expect(createCheck.mock.calls[0][0]).toMatchObject({
			head_sha: 'head',
			conclusion: 'neutral',
			status: 'completed',
		});
		expect(output(createCheck.mock.calls[0]).title).toContain('Skipped');
	});

	it('makes no Checks API call when the input is off', async () => {
		const { client, createCheck } = fakeClient([]);
		await publishReview(toPublisherOctokit(client as never), params([finding]));
		await publishReview(toPublisherOctokit(client as never), {
			...params([finding]),
			checkRun: false,
		});
		expect(createCheck).not.toHaveBeenCalled();
	});
});
