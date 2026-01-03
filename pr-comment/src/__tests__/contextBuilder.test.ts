import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildContextForReply, createDefaultContextOptions } from '../contextBuilder';
import type { OctokitType } from '../types';

describe('contextBuilder', () => {
	let mockOctokit: OctokitType;

	beforeEach(() => {
		mockOctokit = {
			rest: {
				issues: {
					getComment: vi.fn(),
				},
				pulls: {
					listReviews: vi.fn(),
					listCommentsForReview: vi.fn(),
				},
				repos: {
					getContent: vi.fn(),
				},
			},
		} as unknown as OctokitType;
		vi.clearAllMocks();
	});

	describe('buildContextForReply', () => {
		it('should build context with parent AI comment', async () => {
			vi.spyOn(mockOctokit.rest.issues, 'getComment')
				.mockResolvedValueOnce({
					data: {
						id: 456,
						body: 'What is this?',
						in_reply_to_id: 123,
						user: { login: 'developer' },
					},
				} as any)
				.mockResolvedValueOnce({
					data: {
						id: 123,
						body: 'Fix this\n\n<!-- ai-review-id:abc123def456 -->',
						user: { login: 'ai-bot' },
					},
				} as any);

			const result = await buildContextForReply(
				mockOctokit,
				456,
				1,
				'owner',
				'repo',
				'abc123',
				'Fix bug',
				'What is this?',
				'developer',
				'2024-01-01T00:00:00Z',
				createDefaultContextOptions(false, 10000)
			);

			expect(result).not.toBeNull();
			expect(result?.parentComment.id).toBe(123);
			expect(result?.parentComment.aiReviewId).toBe('abc123def456');
			expect(result?.questionComment.id).toBe(456);
		});

		it('should return null when no parent AI comment found', async () => {
			vi.spyOn(mockOctokit.rest.issues, 'getComment').mockResolvedValue({
				data: {
					id: 456,
					body: 'What is this?',
					in_reply_to_id: 123,
					user: { login: 'developer' },
				},
			} as any);

			vi.spyOn(mockOctokit.rest.issues, 'getComment').mockResolvedValue({
				data: {
					id: 123,
					body: 'Not an AI comment',
					user: { login: 'developer' },
				},
			} as any);

			vi.spyOn(mockOctokit.rest.pulls, 'listReviews').mockResolvedValue({
				data: [],
			} as any);

			const result = await buildContextForReply(
				mockOctokit,
				456,
				1,
				'owner',
				'repo',
				'abc123',
				'Fix bug',
				'What is this?',
				'developer',
				'2024-01-01T00:00:00Z',
				createDefaultContextOptions(false, 10000)
			);

			expect(result).toBeNull();
		});

		it('should include file context when includeFullContent is true', async () => {
			vi.spyOn(mockOctokit.rest.issues, 'getComment')
				.mockResolvedValueOnce({
					data: {
						id: 456,
						body: 'What is this?',
						in_reply_to_id: 123,
						user: { login: 'developer' },
					},
				} as any)
				.mockResolvedValueOnce({
					data: {
						id: 123,
						body: 'Fix this\n\n<!-- ai-review-id:abc123def456 -->',
						user: { login: 'ai-bot' },
					},
				} as any);

			vi.spyOn(mockOctokit.rest.repos, 'getContent').mockResolvedValue({
				data: {
					content: Buffer.from('const x = 1;').toString('base64'),
				},
			} as any);

			const result = await buildContextForReply(
				mockOctokit,
				456,
				1,
				'owner',
				'repo',
				'abc123',
				'Fix bug',
				'What is this?',
				'developer',
				'2024-01-01T00:00:00Z',
				createDefaultContextOptions(true, 10000)
			);

			expect(result?.fileContext).toBeDefined();
			expect(result?.fileContext?.content).toBe('const x = 1;');
		});

		it('should truncate content exceeding maxContextChars', async () => {
			vi.spyOn(mockOctokit.rest.issues, 'getComment')
				.mockResolvedValueOnce({
					data: {
						id: 456,
						body: 'What is this?',
						in_reply_to_id: 123,
						user: { login: 'developer' },
					},
				} as any)
				.mockResolvedValueOnce({
					data: {
						id: 123,
						body: 'Fix this\n\n<!-- ai-review-id:abc123def456 -->',
						user: { login: 'ai-bot' },
					},
				} as any);

			const longContent = 'a'.repeat(20000);
			vi.spyOn(mockOctokit.rest.repos, 'getContent').mockResolvedValue({
				data: {
					content: Buffer.from(longContent).toString('base64'),
				},
			} as any);

			const result = await buildContextForReply(
				mockOctokit,
				456,
				1,
				'owner',
				'repo',
				'abc123',
				'Fix bug',
				'What is this?',
				'developer',
				'2024-01-01T00:00:00Z',
				createDefaultContextOptions(true, 10000)
			);

			expect(result?.fileContext?.content?.length).toBe(10000);
		});
	});

	describe('createDefaultContextOptions', () => {
		it('should create default options', () => {
			const options = createDefaultContextOptions();

			expect(options.includeFullContent).toBe(false);
			expect(options.maxContextChars).toBe(10000);
		});

		it('should create custom options', () => {
			const options = createDefaultContextOptions(true, 5000);

			expect(options.includeFullContent).toBe(true);
			expect(options.maxContextChars).toBe(5000);
		});
	});
});

