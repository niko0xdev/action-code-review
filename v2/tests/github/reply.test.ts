import { describe, expect, it, vi } from 'vitest';
import {
	type ReplyParams,
	buildReplyBody,
	replyToReviewComment,
} from '../../src/github/review.js';
import type { Finding } from '../../src/types/finding.js';

function finding(): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		path: 'src/a.ts',
		line: 10,
		title: 'Missing tenant filter',
		description: 'The query retrieves the user only by ID.',
		impact: 'Cross-tenant read possible.',
		replacement: null,
	};
}

describe('replyToReviewComment', () => {
	function makeOctokit() {
		return {
			users: {
				getAuthenticated: vi.fn(async () => ({ data: { login: 'bot' } })),
			},
			rest: {
				pulls: {
					getReviewComment: vi.fn(async () => ({
						data: {
							pull_request_url: 'https://api.github.com/repos/acme/widget/pulls/7',
							body: '<!-- ai-review-id:abcdef123456 -->',
							user: { login: 'bot' },
						},
					})),
					createReplyForReviewComment: vi.fn(async () => ({
						data: {
							id: 987654,
							html_url: 'https://github.com/x/y#comment-987654',
						},
					})),
				},
				issues: {
					createComment: vi.fn(async () => ({ data: {} })),
				},
			},
		};
	}

	it('calls createReplyForReviewComment with the numeric comment id and body', async () => {
		const octokit = makeOctokit();
		const result = await replyToReviewComment(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			commentId: 123456,
			body: 'Confirmed — the fix landed in a follow-up commit.',
		});

		expect(
			octokit.rest.pulls.createReplyForReviewComment
		).toHaveBeenCalledOnce();
		const args = octokit.rest.pulls.createReplyForReviewComment.mock
			.calls[0][0] as Record<string, unknown>;
		expect(args).toMatchObject({
			owner: 'acme',
			repo: 'widget',
			pull_number: 7,
			comment_id: 123456,
		});
		expect(String(args.body)).toContain('Confirmed — the fix');
		expect(result.id).toBe(987654);
	});

	it('throws a clear error when body is missing or empty', async () => {
		const octokit = makeOctokit();
		await expect(
			replyToReviewComment(octokit as never, {
				owner: 'acme',
				repo: 'widget',
				prNumber: 7,
				commentId: 1,
				body: '',
			})
		).rejects.toThrow(/reply body is required/i);
	});

	it('throws when comment_id is missing', async () => {
		const octokit = makeOctokit();
		await expect(
			replyToReviewComment(
				octokit as never,
				{
					owner: 'acme',
					repo: 'widget',
					prNumber: 7,
					commentId: Number.NaN,
					body: 'x',
				} as ReplyParams
			)
		).rejects.toThrow(/comment id is required/i);
	});

	it('does not post a PR summary comment (reply only)', async () => {
		const octokit = makeOctokit();
		await replyToReviewComment(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			commentId: 1,
			body: 'x',
		});
		expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
	});
});

describe('buildReplyBody', () => {
	it('wraps the user body with the ai-review-id marker for dedupe continuity', () => {
		const body = buildReplyBody('Following up on this finding.', finding());
		expect(body).toContain('Following up on this finding.');
		expect(body).toMatch(/<!-- ai-review-id:[a-f0-9]{12} -->$/);
	});

	it('keeps the marker stable for the same finding as buildFindingBody', async () => {
		const { buildFindingBody } = await import('../../src/github/review.js');
		const inline = buildFindingBody(finding());
		const reply = buildReplyBody('extra context', finding());
		const inlineId = inline.match(/ai-review-id:([a-f0-9]{12})/)?.[1];
		const replyId = reply.match(/ai-review-id:([a-f0-9]{12})/)?.[1];
		expect(replyId).toBe(inlineId);
	});
});
