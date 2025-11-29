import { describe, it, expect } from 'vitest';
import { filterCommentsBySeverity } from '../src/reviewParser';
import type { ReviewComment } from '../src/reviewParser';

describe('filterCommentsBySeverity', () => {
	it('should filter comments based on minimum severity', () => {
		const comments: ReviewComment[] = [
			{
				path: 'file1.js',
				line: 1,
				body: 'Info comment\n\n_Severity:_ ℹ️ info — see https://github.com/niko0xdev/action-code-review/tree/main/pr-review#severity-levels',
				id: '1',
			},
			{
				path: 'file1.js',
				line: 2,
				body: 'Low severity comment\n\n_Severity:_ ✅ low — see https://github.com/niko0xdev/action-code-review/tree/main/pr-review#severity-levels',
				id: '2',
			},
			{
				path: 'file1.js',
				line: 3,
				body: 'Medium severity comment\n\n_Severity:_ ⚠️ medium — see https://github.com/niko0xdev/action-code-review/tree/main/pr-review#severity-levels',
				id: '3',
			},
			{
				path: 'file1.js',
				line: 4,
				body: 'High severity comment\n\n_Severity:_ 🔥 high — see https://github.com/niko0xdev/action-code-review/tree/main/pr-review#severity-levels',
				id: '4',
			},
			{
				path: 'file1.js',
				line: 5,
				body: 'Comment without severity',
				id: '5',
			},
		];

		// Test with 'high' minimum severity
		const highSeverityComments = filterCommentsBySeverity(comments, 'high');
		expect(highSeverityComments).toHaveLength(1);
		expect(highSeverityComments[0].id).toBe('4');

		// Test with 'medium' minimum severity
		const mediumSeverityComments = filterCommentsBySeverity(comments, 'medium');
		expect(mediumSeverityComments).toHaveLength(2);
		expect(mediumSeverityComments.map(c => c.id)).toEqual(['3', '4']);

		// Test with 'low' minimum severity
		const lowSeverityComments = filterCommentsBySeverity(comments, 'low');
		expect(lowSeverityComments).toHaveLength(3);
		expect(lowSeverityComments.map(c => c.id)).toEqual(['2', '3', '4']);

		// Test with 'info' minimum severity (default)
		const infoSeverityComments = filterCommentsBySeverity(comments, 'info');
		expect(infoSeverityComments).toHaveLength(5); // All comments including those without severity

		// Test with invalid minimum severity (should default to info)
		const invalidSeverityComments = filterCommentsBySeverity(comments, 'invalid');
		expect(invalidSeverityComments).toHaveLength(5);
	});
});
