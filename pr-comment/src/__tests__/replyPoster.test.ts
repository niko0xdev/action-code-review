import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	postReplyToComment,
	postReplyWithFallback,
} from '../replyPoster';
import type { OctokitType } from '../types';

describe('replyPoster', () => {
	let mockOctokit: OctokitType;
	let mockCreateCommentReply: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockCreateCommentReply = vi.fn();
		mockOctokit = {
			rest: {
				issues: {
					createCommentReply: mockCreateCommentReply,
					createComment: vi.fn(),
				},
			},
		} as unknown as OctokitType;
		vi.clearAllMocks();
	});

	describe('postReplyToComment', () => {
		const options = {
			owner: 'owner',
			repo: 'repo',
			prNumber: 1,
			parentCommentId: 123,
		};

		it('should post reply successfully', async () => {
			mockCreateCommentReply.mockResolvedValue({ data: {} });

			await postReplyToComment(mockOctokit, options, 'Test reply');

			expect(mockCreateCommentReply).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				issue_number: 1,
				comment_id: 123,
				body: expect.stringContaining('Test reply'),
			});
		});

		it('should add ai-reply marker', async () => {
			mockCreateCommentReply.mockResolvedValue({ data: {} });

			await postReplyToComment(mockOctokit, options, 'Test reply');

			const callArgs = mockCreateCommentReply.mock.calls[0][0];
			expect(callArgs.body).toContain('<!-- ai-reply -->');
		});

		it('should not add marker if already present', async () => {
			mockCreateCommentReply.mockResolvedValue({ data: {} });

			await postReplyToComment(
				mockOctokit,
				options,
				'Test reply\n\n<!-- ai-reply -->'
			);

			const callArgs = mockCreateCommentReply.mock.calls[0][0];
			const markerCount = (callArgs.body.match(/<!-- ai-reply -->/g) || []).length;
			expect(markerCount).toBe(1);
		});

		it('should retry on failure', async () => {
			mockCreateCommentReply
				.mockRejectedValueOnce(new Error('Network error'))
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValue({ data: {} });

			await postReplyToComment(mockOctokit, options, 'Test reply');

			expect(mockCreateCommentReply).toHaveBeenCalledTimes(3);
		});

		it('should throw after max attempts', async () => {
			mockCreateCommentReply.mockRejectedValue(new Error('Network error'));

			await expect(
				postReplyToComment(mockOctokit, options, 'Test reply')
			).rejects.toThrow();
		});
	});

	describe('postReplyWithFallback', () => {
		const options = {
			owner: 'owner',
			repo: 'repo',
			prNumber: 1,
			parentCommentId: 123,
		};

		it('should post reply successfully', async () => {
			vi.spyOn(
				mockOctokit.rest.issues,
				'createCommentReply'
			).mockResolvedValue({ data: {} });

			await postReplyWithFallback(mockOctokit, options, 'Test reply');

			expect(mockOctokit.rest.issues.createCommentReply).toHaveBeenCalled();
		});

		it('should use fallback if thread reply fails', async () => {
			vi.spyOn(
				mockOctokit.rest.issues,
				'createCommentReply'
			).mockRejectedValue(new Error('Thread error'));
			vi.spyOn(mockOctokit.rest.issues, 'createComment').mockResolvedValue({
				data: {},
			});

			await postReplyWithFallback(mockOctokit, options, 'Test reply');

			expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				issue_number: 1,
				body: expect.stringContaining('Test reply'),
			});
		});

		it('should throw if both methods fail', async () => {
			vi.spyOn(
				mockOctokit.rest.issues,
				'createCommentReply'
			).mockRejectedValue(new Error('Thread error'));
			vi.spyOn(mockOctokit.rest.issues, 'createComment').mockRejectedValue(
				new Error('Fallback error')
			);

			await expect(
				postReplyWithFallback(mockOctokit, options, 'Test reply')
			).rejects.toThrow();
		});
	});
});

