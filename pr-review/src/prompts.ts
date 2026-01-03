import type { ContextFile } from './types';

const DEFAULT_REVIEW_FOCUS =
	'Focus on correctness, code quality, security, performance, test coverage, and best practices. Provide actionable, line-specific feedback whenever possible.';

function createSystemPrompt(): string {
	return [
		'You are a seasoned staff-level software engineer performing code reviews on GitHub pull requests.',
		'Your goal is to find impactful issues—logic bugs, regressions, security problems, performance pitfalls, and missing tests.',
		'Be direct, reference line numbers from the diff, and keep feedback actionable.',
		'Always respond with STRICT JSON (no Markdown code fences) using UTF-8 characters only.',
	].join(' ');
}

function buildUserPrompt(
	filename: string,
	diff: string,
	reviewFocus: string,
	changedFileContent?: string,
	contextFiles: ContextFile[] = []
): string {
	const promptParts = [
		`You are reviewing changes in the file: ${filename}.`,
		'Assess the diff and respond with the following JSON shape:',
		'{',
		'  "file_overview": "Short paragraph summarizing the overall state of the file.",',
		'  "summary_points": ["Bullet point style takeaways for the author."],',
		'  "positive_insights": ["Optional positive reinforcement if deserved."],',
		'  "risks": ["List of potential regressions, missing tests, or security concerns."],',
		'  "inline_comments": [',
		'    {',
		'      "line": <number>,',
		'      "endLine": <number>,',
		'      "title": "Short label of the issue",',
		'      "comment": "Detailed explanation referencing the code and impact.",',
		'      "recommendation": "Concrete suggestion or fix.",',
		'      "severity": "low | high | critical",',
		'      "documentation_links": ["List of official documentation URLs relevant to the issue (e.g., MDN, TypeScript docs, React docs, etc.)"],',
		'      "suggested_fix": "Code example showing how to fix the issue. Use markdown code blocks with appropriate language tags."',
		'    }',
		'  ]',
		'}',
		'',
		'Line Ranges:',
		'- Use "line" for the starting line number of the issue.',
		'- Use "endLine" to specify the end line if the issue spans multiple lines.',
		'- If the issue is on a single line, set "endLine" to the same value as "line".',
		'- Example: {"line": 15, "endLine": 20} for an issue spanning lines 15-20.',
		'',
		'Severity Levels:',
		'- CRITICAL: Security vulnerabilities, data loss, production breakage, critical bugs that cause system failure',
		'- HIGH: Significant bugs, performance issues, major code smells, edge cases that can cause errors',
		'- LOW: Minor improvements, style suggestions, best practices, optimizations',
		'',
		'Guidelines:',
		'- Only create inline_comments for actionable issues tied to specific line ranges in the diff.',
		'- Use line ranges when issues span multiple lines (e.g., entire function, if block).',
		'- Use CRITICAL sparingly for serious issues that must be fixed before merge.',
		'- If there are no issues, still populate summary_points with a high-level takeaway.',
		'- Keep the JSON valid—do not wrap it in Markdown fences or add commentary outside of the JSON.',
		'- Include relevant official documentation links (MDN, TypeScript, React, Node.js docs, etc.) when applicable.',
		'- Provide code examples in the "suggested_fix" field using markdown code blocks to make fixes easy to implement.',
		`Custom focus areas from the user: ${reviewFocus}`,
		'',
	];

	// Add changed file content if provided
	if (changedFileContent) {
		promptParts.push('Changed file content:');
		promptParts.push('```');
		promptParts.push(changedFileContent);
		promptParts.push('```');
		promptParts.push('');
	}

	// Add context files (dependencies) if any
	if (contextFiles.length > 0) {
		promptParts.push('Related context files (dependencies):');
		promptParts.push('');

		for (const ctxFile of contextFiles) {
			promptParts.push(`File: ${ctxFile.path} (${ctxFile.type})`);
			promptParts.push('```');
			promptParts.push(ctxFile.content);
			promptParts.push('```');
			promptParts.push('');
		}
	}

	promptParts.push('Diff to review:');
	promptParts.push('```diff');
	promptParts.push(diff);
	promptParts.push('```');

	return promptParts.join('\n');
}

export { DEFAULT_REVIEW_FOCUS, buildUserPrompt, createSystemPrompt };
