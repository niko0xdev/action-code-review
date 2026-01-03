import { describe, it, expect, vi } from 'vitest';
import type { ReviewComment } from '../src/reviewParser';
import { postCommentsToPR } from '../src/commentPoster';

describe('postCommentsToPR', () => {
	describe('comment posting', () => {
		it('ends review with COMMENT event', async () => {
			const createReview = vi.fn().mockResolvedValue({});
			const octokitMock = {
				rest: {
					pulls: {
						createReview,
					},
				},
			} as any;

			const comments: ReviewComment[] = [
				{
					path: 'src/file.ts',
					line: 10,
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
						body: 'Inline comment\n\n<!-- ai-review-id:comment-id-1 -->',
						path: 'src/file.ts',
						line: 10,
						side: 'RIGHT',
						commit_id: 'commit-sha',
					},
				],
				event: 'COMMENT',
			});
		});

		it('sends REQUEST_CHANGES event when specified', async () => {
			const createReview = vi.fn().mockResolvedValue({});
			const octokitMock = {
				rest: {
					pulls: {
						createReview,
					},
				},
			} as any;

			const comments: ReviewComment[] = [
				{
					path: 'src/file.ts',
					line: 10,
					body: 'Critical issue',
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
					reviewEvent: 'REQUEST_CHANGES',
				} as any
			);

			expect(createReview).toHaveBeenCalledWith({
				owner: 'octo',
				repo: 'hello-world',
				pull_number: 42,
				comments: [
					{
						body: 'Critical issue\n\n<!-- ai-review-id:comment-id-1 -->',
						path: 'src/file.ts',
						line: 10,
						side: 'RIGHT',
						commit_id: 'commit-sha',
					},
				],
				event: 'REQUEST_CHANGES',
			});
		});
	});
});
