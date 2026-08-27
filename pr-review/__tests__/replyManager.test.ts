import { describe, expect, it, vi } from 'vitest';
import {
	maybePostConfiguredReply,
	readReplyRequest,
	replyToReviewComment,
} from '../src/replyManager';
import type { OctokitType } from '../src/types';

function makeOctokit() {
	return {
		rest: {
			pulls: {
				createReplyForReviewComment: vi.fn(async () => ({
					data: { id: 4242, html_url: 'https://github.com/o/r/pull/1#comment-4242' },
				})),
			},
		},
	} as unknown as OctokitType & {
		rest: {
			pulls: {
				createReplyForReviewComment: ReturnType<typeof vi.fn>;
			};
		};
	};
}

describe('readReplyRequest', () => {
	it('returns null when neither env var is set (default off)', () => {
		expect(readReplyRequest(() => undefined)).toBeNull();
	});

	it('parses a valid comment id and body', () => {
		const request = readReplyRequest((name) =>
			name === 'INPUT_REPLY_TO_COMMENT_ID' ? '12345' : 'follow-up text'
		);
		expect(request).toEqual({ commentId: 12345, body: 'follow-up text' });
	});

	it('rejects non-numeric ids', () => {
		const request = readReplyRequest((name) =>
			name === 'INPUT_REPLY_TO_COMMENT_ID' ? 'abc' : 'body'
		);
		expect(request).toBeNull();
	});

	it('rejects empty bodies', () => {
		const request = readReplyRequest((name) =>
			name === 'INPUT_REPLY_TO_COMMENT_ID' ? '123' : '   '
		);
		expect(request).toBeNull();
	});
});

describe('replyToReviewComment', () => {
	it('posts to createReplyForReviewComment and returns the new comment', async () => {
		const octokit = makeOctokit();
		const outcome = await replyToReviewComment(
			octokit as never,
			'acme',
			'widget',
			7,
			999,
			'checking on this'
		);
		expect(outcome.posted).toBe(true);
		expect(outcome.id).toBe(4242);
		const args = octokit.rest.pulls.createReplyForReviewComment.mock
			.calls[0][0] as Record<string, unknown>;
		expect(args).toMatchObject({
			owner: 'acme',
			repo: 'widget',
			pull_number: 7,
			comment_id: 999,
			body: 'checking on this',
		});
	});

	it('swallows API errors into an unposted outcome', async () => {
		const failing = {
			rest: {
				pulls: {
					createReplyForReviewComment: vi.fn(async () => {
						throw new Error('404 not found');
					}),
				},
			},
		} as never;
		const outcome = await replyToReviewComment(
			failing,
			'o',
			'r',
			1,
			5,
			'x'
		);
		expect(outcome.posted).toBe(false);
		expect(outcome.reason).toContain('404');
	});
});

describe('maybePostConfiguredReply', () => {
	it('is a no-op when no reply is configured', async () => {
		const original = { ...process.env };
		delete process.env.INPUT_REPLY_TO_COMMENT_ID;
		delete process.env.INPUT_REPLY_BODY;
		try {
			const octokit = makeOctokit();
			const outcome = await maybePostConfiguredReply(
				octokit as never,
				'o',
				'r',
				1
			);
			expect(outcome.posted).toBe(false);
			expect(octokit.rest.pulls.createReplyForReviewComment).not.toHaveBeenCalled();
		} finally {
			process.env = original;
		}
	});

	it('posts when both env vars are present', async () => {
		const original = { ...process.env };
		process.env.INPUT_REPLY_TO_COMMENT_ID = '777';
		process.env.INPUT_REPLY_BODY = 'env-driven reply';
		try {
			const octokit = makeOctokit();
			const outcome = await maybePostConfiguredReply(
				octokit as never,
				'o',
				'r',
				2
			);
			expect(outcome.posted).toBe(true);
		} finally {
			process.env = original;
		}
	});
});
