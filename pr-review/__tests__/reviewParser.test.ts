import { describe, it, expect } from 'vitest';
import { filterCommentsBySeverity, parseReviewResponse } from '../src/reviewParser';
import type { ReviewComment } from '../src/reviewParser';

describe('filterCommentsBySeverity', () => {
	it('should filter comments based on minimum severity', () => {
		const comments: ReviewComment[] = [
			{
				path: 'file1.js',
				line: 1,
				startLine: 1,
				endLine: 1,
				body: 'Low severity comment\n\n<!-- _Severity:_ low -->',
				id: '1',
			},
			{
				path: 'file1.js',
				line: 2,
				startLine: 2,
				endLine: 2,
				body: 'High severity comment\n\n<!-- _Severity:_ high -->',
				id: '2',
			},
			{
				path: 'file1.js',
				line: 3,
				startLine: 3,
				endLine: 3,
				body: 'Critical severity comment\n\n<!-- _Severity:_ critical -->',
				id: '3',
			},
			{
				path: 'file1.js',
				line: 4,
				startLine: 4,
				endLine: 4,
				body: 'Comment without severity',
				id: '4',
			},
		];

		// Test with 'critical' minimum severity (default)
		const criticalSeverityComments = filterCommentsBySeverity(comments, 'critical');
		expect(criticalSeverityComments).toHaveLength(1);
		expect(criticalSeverityComments[0].id).toBe('3');

		// Test with 'high' minimum severity
		const highSeverityComments = filterCommentsBySeverity(comments, 'high');
		expect(highSeverityComments).toHaveLength(2);
		expect(highSeverityComments.map(c => c.id)).toEqual(['2', '3']);

		// Test with 'low' minimum severity
		// Now includes comments without severity (defaults to 'low')
		const lowSeverityComments = filterCommentsBySeverity(comments, 'low');
		expect(lowSeverityComments).toHaveLength(4);
		expect(lowSeverityComments.map(c => c.id)).toEqual(['1', '2', '3', '4']);

		// Test with invalid minimum severity (should default to critical)
		const invalidSeverityComments = filterCommentsBySeverity(comments, 'invalid');
		expect(invalidSeverityComments).toHaveLength(1);
		expect(invalidSeverityComments[0].id).toBe('3');
	});

	it('should default comments without severity to low', () => {
		const comments: ReviewComment[] = [
			{
				path: 'file1.js',
				line: 1,
				startLine: 1,
				endLine: 1,
				body: 'Comment without severity',
				id: '1',
			},
		];

		// Comments without severity should be included with 'low' min severity
		const lowSeverityComments = filterCommentsBySeverity(comments, 'low');
		expect(lowSeverityComments).toHaveLength(1);
		expect(lowSeverityComments[0].id).toBe('1');

		// But excluded with higher severity requirements
		const highSeverityComments = filterCommentsBySeverity(comments, 'high');
		expect(highSeverityComments).toHaveLength(0);
	});
});

describe('ID Generation', () => {
	it('generates same ID for same path and line range', () => {
		const reviewText = JSON.stringify({
			inline_comments: [
				{
					line: 10,
					endLine: 15,
					comment: 'Test comment',
				},
			],
		});

		const result1 = parseReviewResponse(reviewText, 'src/test.ts');
		const result2 = parseReviewResponse(reviewText, 'src/test.ts');

		expect(result1.comments[0].id).toBe(result2.comments[0].id);
	});

	it('generates different IDs for different line ranges', () => {
		const reviewText1 = JSON.stringify({
			inline_comments: [
				{
					line: 10,
					endLine: 15,
					comment: 'Test comment',
				},
			],
		});

		const reviewText2 = JSON.stringify({
			inline_comments: [
				{
					line: 20,
					endLine: 25,
					comment: 'Test comment',
				},
			],
		});

		const result1 = parseReviewResponse(reviewText1, 'src/test.ts');
		const result2 = parseReviewResponse(reviewText2, 'src/test.ts');

		expect(result1.comments[0].id).not.toBe(result2.comments[0].id);
	});

	it('generates different IDs for different files', () => {
		const reviewText = JSON.stringify({
			inline_comments: [
				{
					line: 10,
					endLine: 15,
					comment: 'Test comment',
				},
			],
		});

		const result1 = parseReviewResponse(reviewText, 'src/test1.ts');
		const result2 = parseReviewResponse(reviewText, 'src/test2.ts');

		expect(result1.comments[0].id).not.toBe(result2.comments[0].id);
	});
});

describe('Multi-line Range Support', () => {
	it('handles single-line comments', () => {
		const reviewText = JSON.stringify({
			inline_comments: [
				{
					line: 10,
					endLine: 10,
					comment: 'Single line issue',
				},
			],
		});

		const result = parseReviewResponse(reviewText, 'src/test.ts');

		expect(result.comments).toHaveLength(1);
		expect(result.comments[0].startLine).toBe(10);
		expect(result.comments[0].endLine).toBe(10);
	});

	it('handles multi-line comments', () => {
		const reviewText = JSON.stringify({
			inline_comments: [
				{
					line: 15,
					endLine: 20,
					comment: 'Multi-line issue',
				},
			],
		});

		const result = parseReviewResponse(reviewText, 'src/test.ts');

		expect(result.comments).toHaveLength(1);
		expect(result.comments[0].startLine).toBe(15);
		expect(result.comments[0].endLine).toBe(20);
	});

	it('defaults endLine when not provided', () => {
		const reviewText = JSON.stringify({
			inline_comments: [
				{
					line: 10,
					comment: 'No endLine provided',
				},
			],
		});

		const result = parseReviewResponse(reviewText, 'src/test.ts');

		expect(result.comments).toHaveLength(1);
		expect(result.comments[0].startLine).toBe(10);
		expect(result.comments[0].endLine).toBe(10);
	});
});
