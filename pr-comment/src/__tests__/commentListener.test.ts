import { describe, expect, it } from 'vitest';
import {
	createDefaultQuestionDetectionConfig,
	extractAiReviewId,
	isAiComment,
	isAiReply,
	isBotComment,
	isQuestionComment,
	shouldTriggerReply,
} from '../commentListener';

describe('commentListener', () => {
	describe('isQuestionComment', () => {
		it('should detect question mark', () => {
			const config = createDefaultQuestionDetectionConfig(true);
			expect(isQuestionComment('What is this?', config)).toBe(true);
		});

		it('should detect question keywords', () => {
			const config = createDefaultQuestionDetectionConfig(true);
			expect(isQuestionComment('How does this work', config)).toBe(true);
			expect(isQuestionComment('Why is this happening', config)).toBe(true);
			expect(isQuestionComment('Can you explain this', config)).toBe(true);
		});

		it('should not detect non-questions', () => {
			const config = createDefaultQuestionDetectionConfig(true);
			expect(isQuestionComment('This looks good', config)).toBe(false);
			expect(isQuestionComment('Fixed the issue', config)).toBe(false);
		});

		it('should always return true when detection is disabled', () => {
			const config = createDefaultQuestionDetectionConfig(false);
			expect(isQuestionComment('This is not a question', config)).toBe(true);
		});
	});

	describe('isAiComment', () => {
		it('should detect AI comments with ai-review-id marker', () => {
			expect(
				isAiComment('Some comment\n\n<!-- ai-review-id:abc123def456 -->')
			).toBe(true);
		});

		it('should not detect non-AI comments', () => {
			expect(isAiComment('Just a regular comment')).toBe(false);
			expect(isAiComment('<!-- some other marker -->')).toBe(false);
		});
	});

	describe('extractAiReviewId', () => {
		it('should extract AI review ID from comment', () => {
			const comment = 'Fix this\n\n<!-- ai-review-id:abc123def456 -->';
			expect(extractAiReviewId(comment)).toBe('abc123def456');
		});

		it('should return null when no marker exists', () => {
			expect(extractAiReviewId('No marker here')).toBe(null);
		});

		it('should handle invalid IDs', () => {
			const comment = 'Fix this\n\n<!-- ai-review-id:invalid -->';
			expect(extractAiReviewId(comment)).toBe(null);
		});
	});

	describe('isAiReply', () => {
		it('should detect AI replies', () => {
			expect(isAiReply('Here is the answer\n\n<!-- ai-reply -->')).toBe(true);
		});

		it('should not detect non-AI replies', () => {
			expect(isAiReply('Just a reply')).toBe(false);
		});
	});

	describe('isBotComment', () => {
		it('should detect bot comments', () => {
			expect(isBotComment('Bot')).toBe(true);
		});

		it('should not detect human comments', () => {
			expect(isBotComment('User')).toBe(false);
			expect(isBotComment(undefined)).toBe(false);
		});
	});

	describe('shouldTriggerReply', () => {
		const config = createDefaultQuestionDetectionConfig(true);

		it('should trigger for valid question from human', () => {
			expect(shouldTriggerReply('What is this?', 'User', config)).toBe(true);
		});

		it('should not trigger for bot comments', () => {
			expect(shouldTriggerReply('What is this?', 'Bot', config)).toBe(false);
		});

		it('should not trigger for AI replies', () => {
			expect(
				shouldTriggerReply(
					'This is an AI reply\n\n<!-- ai-reply -->',
					'User',
					config
				)
			).toBe(false);
		});

		it('should not trigger for non-questions', () => {
			expect(shouldTriggerReply('Looks good', 'User', config)).toBe(false);
		});
	});
});
