import { describe, it, expect } from 'vitest';
import { parseReviewForComments } from '../src/index';

describe('parseReviewForComments', () => {
  it('should parse line-specific comments correctly', () => {
    const reviewText = `
Line 10: This variable should be const instead of let since it's not reassigned.
Line 25: Consider adding error handling for this async operation.
Line 42: This function could be simplified by using array methods.
    `;
    
    const filename = 'example.js';
    const comments = parseReviewForComments(reviewText, filename);
    
    expect(comments).toHaveLength(3);
    expect(comments[0]).toEqual({
      path: filename,
      line: 10,
      body: 'This variable should be const instead of let since it\'s not reassigned.'
    });
    expect(comments[1]).toEqual({
      path: filename,
      line: 25,
      body: 'Consider adding error handling for this async operation.'
    });
    expect(comments[2]).toEqual({
      path: filename,
      line: 42,
      body: 'This function could be simplified by using array methods.'
    });
  });

  it('should handle alternative line format (L42:)', () => {
    const reviewText = `
L10: This is a comment with L format.
L25: Another comment with L format.
    `;
    
    const filename = 'example.js';
    const comments = parseReviewForComments(reviewText, filename);
    
    expect(comments).toHaveLength(2);
    expect(comments[0].line).toBe(10);
    expect(comments[1].line).toBe(25);
  });

  it('should create a general comment when no line-specific comments are found', () => {
    const reviewText = 'This is a general comment about the code quality.';
    
    const filename = 'example.js';
    const comments = parseReviewForComments(reviewText, filename);
    
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual({
      path: filename,
      line: 1,
      body: reviewText
    });
  });

  it('should handle multiline comments', () => {
    const reviewText = `
Line 10: This is a multiline comment.
It continues on this line.
And also on this line.

Line 20: This is another comment.
    `;
    
    const filename = 'example.js';
    const comments = parseReviewForComments(reviewText, filename);
    
    expect(comments).toHaveLength(2);
    expect(comments[0].body).toContain('This is a multiline comment.');
    expect(comments[0].body).toContain('It continues on this line.');
    expect(comments[0].body).toContain('And also on this line.');
  });
});
