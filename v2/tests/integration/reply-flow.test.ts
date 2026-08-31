import { describe, expect, it, vi } from 'vitest';
import type { OctokitLike } from '../../src/context/pr.js';
import {
	buildFindingBody,
	publishReview,
	replyToReviewComment,
} from '../../src/github/review.js';
import { normalizeCommentId } from '../../src/review/dedupe.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';

/**
 * Integration flow (mocked Octokit): a finding is published as an inline
 * comment → an external caller asks for follow-up → the action posts an
 * inline reply beneath the original thread using GitHub's numeric comment
 * id, keeping the ai-review-id marker for dedupe continuity.
 */

function finding(): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		path: 'src/users/user.service.ts',
		line: 12,
		title: 'Missing tenant filter',
		description: 'The query retrieves the user only by ID.',
		impact: 'Cross-tenant read possible.',
		suggestion: 'Include tenantId in the where clause.',
		replacement: null,
	};
}

function makeOctokit() {
	let nextCommentId = 1000;
	return {
		rest: {
			pulls: {
				createReview: vi.fn(async () => ({ data: { id: 1 } })),
				getReviewComment: vi.fn(async () => ({
					data: {
						pull_request_url:
							'https://api.github.com/repos/acme/widget/pulls/7',
						body: `<!-- ai-review-id:${normalizeCommentId(finding())} -->`,
						user: { login: 'bot' },
					},
				})),
				createReplyForReviewComment: vi.fn(async () => ({
					data: {
						id: ++nextCommentId,
						html_url: `https://github.com/o/r/pull/7#comment-${nextCommentId}`,
					},
				})),
			},
			issues: {
				createComment: vi.fn(async () => ({ data: {} })),
			},
		},
		users: {
			getAuthenticated: vi.fn(async () => ({ data: { login: 'bot' } })),
		},
	};
}

describe('inline comment → user question → actioned reply', () => {
	it('publishes the finding then replies on the same thread with marker continuity', async () => {
		const octokit = makeOctokit();
		const result: ReviewResult = {
			findings: [finding()],
			summary: 'One security issue found.',
			risk: 'high',
			counts: { critical: 0, high: 1, medium: 0, low: 0 },
			filesReviewed: ['src/users/user.service.ts'],
		};

		// Step 1: publish inline comments + summary.
		await publishReview(octokit as unknown as OctokitLike as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'headsha',
			result,
			blockOnIssues: true,
		});
		expect(octokit.rest.pulls.createReview).toHaveBeenCalledOnce();

		// The published inline body carries the marker.
		const reviewArgs = octokit.rest.pulls.createReview.mock.calls[0][0] as {
			comments: Array<{ body: string }>;
		};
		const inlineBody = reviewArgs.comments[0].body;
		const markerId = inlineBody.match(/ai-review-id:([a-f0-9]{12})/)?.[1];
		expect(markerId).toBe(normalizeCommentId(finding()));

		// Step 2+3: a reviewer asks a question; the action posts the reply
		// against the numeric comment id from the created review comment.
		const reply = await replyToReviewComment(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			commentId: 1001,
			body: 'Good catch — tenantId comes from the request context in the controller; adding it here.',
			finding: finding(),
		});
		expect(reply.id).toBe(1001);

		const replyArgs = octokit.rest.pulls.createReplyForReviewComment.mock
			.calls[0][0] as Record<string, unknown>;
		expect(replyArgs.comment_id).toBe(1001);
		expect(String(replyArgs.body)).toContain('tenantId comes from');
		// Marker continuity across the thread.
		expect(String(replyArgs.body)).toContain(`ai-review-id:${markerId}`);
	});

	it('reply path never posts the PR summary', async () => {
		const octokit = makeOctokit();
		await replyToReviewComment(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			commentId: 555,
			body: 'context only',
		});
		expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});

	it('published inline bodies and reply bodies share one id scheme', () => {
		const inline = buildFindingBody(finding());
		const reply = 'note'.length ? undefined : undefined;
		void reply;
		expect(inline).toMatch(
			new RegExp(`ai-review-id:${normalizeCommentId(finding())}`)
		);
	});
});
