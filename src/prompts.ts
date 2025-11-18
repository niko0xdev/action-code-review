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
	reviewFocus: string
): string {
	return [
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
		'      "title": "Short label of the issue",',
		'      "comment": "Detailed explanation referencing the code and impact.",',
		'      "recommendation": "Concrete suggestion or fix.",',
		'      "severity": "info | low | medium | high"',
		'    }',
		'  ]',
		'}',
		'',
		'Guidelines:',
		'- Only create inline_comments for actionable issues tied to a specific line in the diff.',
		'- If there are no issues, still populate summary_points with a high-level takeaway.',
		'- Keep the JSON valid—do not wrap it in Markdown fences or add commentary outside of the JSON.',
		`Custom focus areas from the user: ${reviewFocus}`,
		'',
		'Diff to review:',
		'```diff',
		diff,
		'```',
	].join('\n');
}

export { DEFAULT_REVIEW_FOCUS, buildUserPrompt, createSystemPrompt };
