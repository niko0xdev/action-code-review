import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { generateReply, validateReply } from '../replyGenerator';
import type { CommentContext } from '../types';

describe('replyGenerator', () => {
	const mockOpenai = {
		chat: {
			completions: {
				create: vi.fn(),
			},
		},
	} as unknown as OpenAI;

	const mockContext: CommentContext = {
		parentComment: {
			id: 123,
			body: 'You should use async/await here',
			userLogin: 'ai-bot',
			aiReviewId: 'abc123def456',
		},
		questionComment: {
			id: 456,
			body: 'Why should I use async/await?',
			userLogin: 'developer',
			createdAt: '2024-01-01T00:00:00Z',
		},
		prContext: {
			number: 1,
			title: 'Fix bug',
			owner: 'owner',
			repo: 'repo',
			headSha: 'abc123',
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('generateReply', () => {
		it('should generate a reply successfully', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Async/await is better for readability and error handling.',
						},
					},
				],
			};

			vi.mocked(mockOpenai.chat.completions.create).mockResolvedValue(
				mockResponse as any
			);

			const result = await generateReply(mockOpenai, mockContext, 'gpt-4');

			expect(result).toBe('Async/await is better for readability and error handling.');
			expect(mockOpenai.chat.completions.create).toHaveBeenCalledWith(
				expect.objectContaining({
					model: 'gpt-4',
					temperature: 0.7,
					max_tokens: 1000,
				})
			);
		});

		it('should use custom prompt if provided', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: 'Custom response',
						},
					},
				],
			};

			vi.mocked(mockOpenai.chat.completions.create).mockResolvedValue(
				mockResponse as any
			);

			const customPrompt = 'Be very concise';
			await generateReply(mockOpenai, mockContext, 'gpt-4', customPrompt);

			const callArgs = vi.mocked(mockOpenai.chat.completions.create).mock.calls[0];
			expect(callArgs[0].messages[0].content).toContain(customPrompt);
		});

		it('should handle empty AI response', async () => {
			const mockResponse = {
				choices: [
					{
						message: {
							content: null,
						},
					},
				],
			};

			vi.mocked(mockOpenai.chat.completions.create).mockResolvedValue(
				mockResponse as any
			);

			const result = await generateReply(mockOpenai, mockContext, 'gpt-4');

			expect(result).toContain("I apologize, but I wasn't able to generate");
		});

		it('should handle API errors', async () => {
			vi.mocked(mockOpenai.chat.completions.create).mockRejectedValue(
				new Error('API error')
			);

			await expect(
				generateReply(mockOpenai, mockContext, 'gpt-4')
			).rejects.toThrow();
		});
	});

	describe('validateReply', () => {
		it('should validate valid reply', () => {
			expect(validateReply('This is a valid reply')).toBe(true);
		});

		it('should reject empty reply', () => {
			expect(validateReply('')).toBe(false);
			expect(validateReply('   ')).toBe(false);
		});

		it('should reject reply that is too long', () => {
			const longReply = 'a'.repeat(5001);
			expect(validateReply(longReply)).toBe(false);
		});

		it('should accept reply at max length', () => {
			const maxReply = 'a'.repeat(5000);
			expect(validateReply(maxReply)).toBe(true);
		});
	});
});

