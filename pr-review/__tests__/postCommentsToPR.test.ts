import { describe, it, expect, vi } from 'vitest';
import type { ReviewComment } from '../src/reviewParser';
import { postCommentsToPR, checkLineOverlap } from '../src/commentPoster';

describe('postCommentsToPR', () => {
	describe('comment posting', () => {
		it('ends review with COMMENT event', async () => {
			const createReview = vi.fn().mockResolvedValue({});
			const listReviews = vi.fn().mockResolvedValue({ data: [] });
			const octokitMock = {
				rest: {
					users: {
						getAuthenticated: vi.fn().mockResolvedValue({ data: { login: 'bot-user' } }),
					},
					pulls: {
						listReviews,
						createReview,
					},
				},
			} as any;

			const comments: ReviewComment[] = [
				{
					path: 'src/file.ts',
					line: 10,
					startLine: 10,
					endLine: 10,
					body: 'Inline comment',
					id: 'comment-id-1',
				},
			];

			await postCommentsToPR(
				octokitMock,
				comments,
				'commit-sha',
				{
					owner: 'octo',
					repo: 'hello-world',
					prNumber: 42,
					headSha: 'commit-sha',
					reviewEvent: 'COMMENT',
				} as any
			);

			expect(createReview).toHaveBeenCalledWith({
				owner: 'octo',
				repo: 'hello-world',
				pull_number: 42,
				comments: [
					{
						body: 'Inline comment\n\n<!-- ai-review-range:10-10 -->\n<!-- ai-review-id:comment-id-1 -->',
						path: 'src/file.ts',
						line: 10,
						side: 'RIGHT',
						commit_id: 'commit-sha',
					},
				],
				event: 'COMMENT',
			});
		});

		it('supports multi-line ranges', async () => {
			const createReview = vi.fn().mockResolvedValue({});
			const listReviews = vi.fn().mockResolvedValue({ data: [] });
			const octokitMock = {
				rest: {
					users: {
						getAuthenticated: vi.fn().mockResolvedValue({ data: { login: 'bot-user' } }),
					},
					pulls: {
						listReviews,
						createReview,
					},
				},
			} as any;

			const comments: ReviewComment[] = [
				{
					path: 'src/file.ts',
					line: 15,
					startLine: 15,
					endLine: 20,
					body: 'Multi-line issue',
					id: 'comment-id-1',
				},
			];

			await postCommentsToPR(
				octokitMock,
				comments,
				'commit-sha',
				{
					owner: 'octo',
					repo: 'hello-world',
					prNumber: 42,
					headSha: 'commit-sha',
					reviewEvent: 'COMMENT',
				} as any
			);

			expect(createReview).toHaveBeenCalledWith({
				owner: 'octo',
				repo: 'hello-world',
				pull_number: 42,
				comments: [
					{
						body: 'Multi-line issue\n\n<!-- ai-review-range:15-20 -->\n<!-- ai-review-id:comment-id-1 -->',
						path: 'src/file.ts',
						line: 15,
						side: 'RIGHT',
						commit_id: 'commit-sha',
					},
				],
				event: 'COMMENT',
			});
		});

		it('updates existing comments instead of creating duplicates', async () => {
			const existingId = '123456789abc'; // 12-char hex ID
			const mockListReviews = vi.fn().mockResolvedValue({
				data: [
					{
						user: { login: 'bot-user' },
						id: 123,
					},
				],
			});
			const mockListCommentsForReview = vi.fn().mockResolvedValue({
				data: [
					{
						id: 456,
						path: 'src/file.ts',
						line: 10,
						body: 'Old comment body\n\n<!-- ai-review-range:10-10 -->\n<!-- ai-review-id:123456789abc -->',
					},
				],
			});
			const mockUpdateReviewComment = vi.fn().mockResolvedValue({});
			const mockCreateReview = vi.fn().mockRejectedValue(new Error('Test error'));
			const octokitMock = {
				rest: {
					users: {
						getAuthenticated: vi.fn().mockResolvedValue({ data: { login: 'bot-user' } }),
					},
					pulls: {
						listReviews: mockListReviews,
						listCommentsForReview: mockListCommentsForReview,
						updateReviewComment: mockUpdateReviewComment,
						createReviewComment: mockCreateReview,
					},
					issues: {
						createComment: vi.fn().mockResolvedValue({ data: { id: 999 } }),
					},
				},
			} as any;

			const comments: ReviewComment[] = [
				{
					path: 'src/file.ts',
					line: 10,
					startLine: 10,
					endLine: 10,
					body: 'Updated comment body',
					id: existingId,
				},
			];

			await postCommentsToPR(
				octokitMock,
				comments,
				'commit-sha',
				{
					owner: 'octo',
					repo: 'hello-world',
					prNumber: 42,
					headSha: 'commit-sha',
					reviewEvent: 'COMMENT',
				} as any
			);

			expect(mockUpdateReviewComment).toHaveBeenCalled();
			expect(mockUpdateReviewComment).toHaveBeenCalledWith({
				comment_id: 456,
				body: 'Updated comment body\n\n<!-- ai-review-range:10-10 -->\n<!-- ai-review-id:123456789abc -->',
			});
			expect(mockCreateReview).not.toHaveBeenCalled();
		});
	});
});

describe('checkLineOverlap', () => {
	it('detects overlapping ranges', () => {
		expect(checkLineOverlap(15, 20, 14, 21)).toBe(true); // Example from requirements
		expect(checkLineOverlap(10, 20, 15, 25)).toBe(true);
		expect(checkLineOverlap(15, 25, 10, 20)).toBe(true);
	});

	it('detects non-overlapping ranges', () => {
		expect(checkLineOverlap(10, 20, 21, 30)).toBe(false);
		expect(checkLineOverlap(21, 30, 10, 20)).toBe(false);
	});

	it('handles edge cases', () => {
		expect(checkLineOverlap(10, 10, 10, 10)).toBe(true); // Same line
		expect(checkLineOverlap(10, 20, 20, 30)).toBe(true); // Adjacent lines
		expect(checkLineOverlap(10, 19, 20, 30)).toBe(false); // Non-adjacent
	});
});
