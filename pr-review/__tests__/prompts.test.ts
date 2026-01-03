import { describe, it, expect } from 'vitest';
import { buildUserPrompt } from '../src/prompts';

describe('buildUserPrompt', () => {
	const filename = 'src/example.ts';
	const diff = '@@ -1,3 +1,4 @@\n function test() {\n+  console.log("hello");\n   return true;\n }';
	const reviewFocus = 'Focus on security and performance.';

	it('should build prompt without full content', () => {
		const prompt = buildUserPrompt(filename, diff, reviewFocus);

		expect(prompt).toContain(`You are reviewing changes in the file: ${filename}.`);
		expect(prompt).toContain('Diff to review:');
		expect(prompt).toContain('```diff');
		expect(prompt).toContain(diff);
		expect(prompt).toContain(reviewFocus);
		expect(prompt).not.toContain('Full file content:');
	});

	it('should build prompt with full content when provided', () => {
		const fullContent = 'export function test() {\n  return true;\n}';
		const prompt = buildUserPrompt(filename, diff, reviewFocus, fullContent);

		expect(prompt).toContain(`You are reviewing changes in the file: ${filename}.`);
		expect(prompt).toContain('Full file content:');
		expect(prompt).toContain('```');
		expect(prompt).toContain(fullContent);
		expect(prompt).toContain('Diff to review:');
		expect(prompt).toContain('```diff');
		expect(prompt).toContain(diff);
		expect(prompt).toContain(reviewFocus);
	});

	it('should include severity levels and guidelines', () => {
		const prompt = buildUserPrompt(filename, diff, reviewFocus);

		expect(prompt).toContain('Severity Levels:');
		expect(prompt).toContain('CRITICAL: Security vulnerabilities, data loss, production breakage');
		expect(prompt).toContain('HIGH: Significant bugs, performance issues');
		expect(prompt).toContain('LOW: Minor improvements, style suggestions');
		expect(prompt).toContain('Guidelines:');
	});

	it('should include JSON response structure', () => {
		const prompt = buildUserPrompt(filename, diff, reviewFocus);

		expect(prompt).toContain('"file_overview"');
		expect(prompt).toContain('"summary_points"');
		expect(prompt).toContain('"inline_comments"');
		expect(prompt).toContain('"severity"');
	});

	it('should handle multi-line diff correctly', () => {
		const multiLineDiff = `@@ -1,5 +1,7 @@
 function calculateSum(a, b) {
-  return a + b;
+  const result = a + b;
+  if (result < 0) return 0;
+  return result;
 }
`;

		const prompt = buildUserPrompt(filename, multiLineDiff, reviewFocus);

		expect(prompt).toContain(multiLineDiff);
		expect(prompt).toContain('```diff');
	});

	it('should handle empty diff', () => {
		const emptyDiff = '';
		const prompt = buildUserPrompt(filename, emptyDiff, reviewFocus);

		expect(prompt).toContain('Diff to review:');
		expect(prompt).toContain('```diff');
	});

	it('should include custom focus areas in prompt', () => {
		const customFocus = 'Prioritize security issues and test coverage.';
		const prompt = buildUserPrompt(filename, diff, customFocus);

		expect(prompt).toContain(`Custom focus areas from the user: ${customFocus}`);
	});
});

