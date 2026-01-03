import { describe, it, expect } from 'vitest';
import { filterCommentsBySeverity } from '../src/reviewParser';
import type { ReviewComment } from '../src/reviewParser';

describe('filterCommentsBySeverity', () => {
	it('should filter comments based on minimum severity', () => {
		const comments: ReviewComment[] = [
			{
				path: 'file1.js',
				line: 1,
				body: 'Low severity comment\n\n<!-- _Severity:_ low -->',
				id: '1',
			},
			{
				path: 'file1.js',
				line: 2,
				body: 'High severity comment\n\n<!-- _Severity:_ high -->',
				id: '2',
			},
			{
				path: 'file1.js',
				line: 3,
				body: 'Critical severity comment\n\n<!-- _Severity:_ critical -->',
				id: '3',
			},
			{
				path: 'file1.js',
				line: 4,
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
		const lowSeverityComments = filterCommentsBySeverity(comments, 'low');
		expect(lowSeverityComments).toHaveLength(3);
		expect(lowSeverityComments.map(c => c.id)).toEqual(['1', '2', '3']);

		// Test with invalid minimum severity (should default to critical)
		const invalidSeverityComments = filterCommentsBySeverity(comments, 'invalid');
		expect(invalidSeverityComments).toHaveLength(1);
		expect(invalidSeverityComments[0].id).toBe('3');

		// Test that comments without severity are filtered out
		expect(filterCommentsBySeverity(comments, 'critical')).toHaveLength(1);
	});
});
