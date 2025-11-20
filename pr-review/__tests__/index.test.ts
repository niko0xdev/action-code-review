import { describe, it, expect } from 'vitest';
import { filterFiles, parseReviewForComments, parseReviewResponse } from '../src/index';

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

  it('should parse structured JSON responses', () => {
    const reviewText = `
{
  "file_overview": "File looks mostly good but needs stronger error handling.",
  "summary_points": [
    "Consider expanding validation to avoid runtime errors."
  ],
  "inline_comments": [
    {
      "line": 32,
      "title": "Missing null check",
      "comment": "userInput may be undefined leading to a crash.",
      "recommendation": "Guard the value before using it.",
      "severity": "high"
    }
  ]
}
    `;

    const filename = 'example.js';
    const parsed = parseReviewResponse(reviewText, filename);

    expect(parsed.summary).toContain('validation');
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]).toEqual({
      path: filename,
      line: 32,
      body: '**Missing null check**\n\nuserInput may be undefined leading to a crash.\n\n_Recommendation:_ Guard the value before using it.\n\n_Severity:_ high'
    });
  });

  it('should fall back to text parsing when JSON is invalid', () => {
    const reviewText = `
Line 5: You can memoize this selector to avoid re-renders.
Line 12: Consider extracting this logic into a helper.
    `;

    const filename = 'example.ts';
    const parsed = parseReviewResponse(reviewText, filename);

    expect(parsed.comments).toHaveLength(2);
    expect(parsed.summary).toContain('Line 5');
  });
});

describe('filterFiles', () => {
  const baseFiles = [
    { filename: 'config.json' },
    { filename: 'config.json.ts' },
    { filename: 'README.md' },
    { filename: 'notes.txt' },
    { filename: 'src/index.ts' },
    { filename: 'config.yaml' },
  ];

  it('excludes files matching glob patterns without over-matching extensions', () => {
    const filtered = filterFiles(baseFiles as any, '*.json', 10);
    const filenames = filtered.map((file: any) => file.filename);

    expect(filenames).not.toContain('config.json');
    expect(filenames).toContain('config.json.ts');
  });

  it('applies default exclusion patterns', () => {
    const filtered = filterFiles(
      baseFiles as any,
      '*.md,*.txt,*.json,*.yml,*.yaml',
      10,
    );
    const filenames = filtered.map((file: any) => file.filename);

    expect(filenames).toContain('src/index.ts');
    expect(filenames).not.toContain('README.md');
    expect(filenames).not.toContain('notes.txt');
    expect(filenames).not.toContain('config.json');
    expect(filenames).not.toContain('config.yaml');
  });
});
