import { describe, expect, it, vi } from 'vitest';
import {
	buildFindingBody,
	publishReview,
	replyToReviewComment,
} from '../../src/github/review.js';
import type { OctokitLike } from '../../src/context/pr.js';
import { normalizeCommentId } from '../../src/review/dedupe.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';

/**
 * End-to-end inline-reply scenario (mocked Octokit, no network).
 *
 * Exercises the flow shipped in #29:
 *  1. publishReview posts an inline comment via createReview
 *  2. a simulated client call replies inline via createReplyForReviewComment
 *     against the numeric comment id returned by GitHub
 *  3. assertions check marker continuity, call counts, and reply-only behavior.
 */

function finding(): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		path: 'pr-review/__tests__/fixtures/reply-target/target.ts',
		line: 5,
		title: 'Unused variable and debug logging',
		description:
			'The handler declares an unused variable and leaves a console.log.',
		impact: 'Noise in production logs; dead code.',
		suggestion: 'Remove the unused variable and debug log before merge.',
		replacement: null,
	};
}

function makeOctokit() {
	let nextReplyId = 2001;
	return {
		rest: {
			pulls: {
				createReview: vi.fn(async () => ({ data: { id: 1 } })),
				createReplyForReviewComment: vi.fn(async () => ({
					data: {
						id: nextReplyId++,
						html_url: `https://github.com/niko0xdev/action-code-review/pull/31#discussion_r${nextReplyId}`,
					},
				})),
			},
			issues: {
				createComment: vi.fn(async () => ({ data: {} })),
			},
		},
	};
}

describe('e2e inline-reply scenario (fixture: reply-target)', () => {
	it('publishes a review via createReview then replies via createReplyForReviewComment with ai-review-id marker continuity', async () => {
		const octokit = makeOctokit();
		const result: ReviewResult = {
			findings: [finding()],
			summary: 'One issue found in reply-target fixture.',
			risk: 'low',
			counts: { critical: 0, high: 1, medium: 0, low: 0 },
			filesReviewed: [
				'pr-review/__tests__/fixtures/reply-target/target.ts',
			],
		};

		// Step 1 — publish inline comment + summary.
		await publishReview(octokit as unknown as OctokitLike as never, {
			owner: 'niko0xdev',
			repo: 'action-code-review',
			prNumber: 31,
			headSha: 'e2e-head',
			result,
			blockOnIssues: false,
		});

		expect(octokit.rest.pulls.createReview).toHaveBeenCalledOnce();
		const createReviewArgs = octokit.rest.pulls.createReview.mock
			.calls[0][0] as {
			comments: Array<{ body: string; path: string }>;
			event: string;
		};
		expect(createReviewArgs.comments[0].path).toBe(
			'pr-review/__tests__/fixtures/reply-target/target.ts'
		);
		// Every inline body carries the ai-review-id marker.
		const inlineBody: string = createReviewArgs.comments[0].body;
		expect(inlineBody).toMatch(/<!-- ai-review-id:[a-f0-9]{12} -->$/);
		expect(inlineBody).toBe(buildFindingBody(finding()));
		const markerId = inlineBody.match(/ai-review-id:([a-f0-9]{12})/)?.[1];
		expect(markerId).toBe(normalizeCommentId(finding()));

		// Simulate that GitHub returned comment id 1001 for the inline comment.
		const simulatedCommentId = 1001;

		// Step 2 — inline reply against that comment id.
		const reply = await replyToReviewComment(octokit as never, {
			owner: 'niko0xdev',
			repo: 'action-code-review',
			prNumber: 31,
			commentId: simulatedCommentId,
			body: 'Acknowledged — removing unused variable and console.log.',
			finding: finding(),
		});

		expect(reply.id).toBe(2001);
		expect(octokit.rest.pulls.createReplyForReviewComment).toHaveBeenCalledOnce();
		const replyArgs = octokit.rest.pulls.createReplyForReviewComment.mock
			.calls[0][0] as Record<string, unknown>;
		expect(replyArgs.comment_id).toBe(simulatedCommentId);
		expect(replyArgs.pull_number).toBe(31);
		expect(String(replyArgs.body)).toContain(
			'removing unused variable'
		);
		// Marker continuity across the thread (dedupe).
		expect(String(replyArgs.body)).toContain(`ai-review-id:${markerId}`);
		expect(String(replyArgs.body)).toMatch(
			/<!-- ai-review-id:[a-f0-9]{12} -->$/
		);

		// Reply path is reply-only: no PR summary re-posted here.
		// (createComment was called once by publishReview for the summary,
		// but replyToReviewComment must not call it again.)
		expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
	});

	it('reply path creates exactly one createReplyForReviewComment call and no createReview', async () => {
		const octokit = makeOctokit();
		await replyToReviewComment(octokit as never, {
			owner: 'niko0xdev',
			repo: 'action-code-review',
			prNumber: 31,
			commentId: 999,
			body: 'Follow-up context.',
		});
		expect(octokit.rest.pulls.createReplyForReviewComment).toHaveBeenCalledOnce();
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
		expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
	});
});
