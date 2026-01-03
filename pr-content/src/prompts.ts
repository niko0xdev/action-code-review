export function createSystemPrompt(customInstructions: string, templateContent?: string): string {
	const basePrompt = [
		'You are an expert software engineer and technical writer.',
		'Generate clear, accurate PR titles and descriptions that help reviewers understand changes quickly.',
		'Title: Use conventional commit format (feat/fix/docs/refactor/etc) and be specific about what changed.',
		'Description should include: what changed, technical impact, why the change is needed, and context reviewers need.',
		'Focus on: scope of changes, breaking changes, performance impact, and testing considerations.',
		'Be technically accurate - describe actual code changes without speculation.',
		'Avoid jargon and ambiguous language - write for engineers who may not know the codebase.',
		'Respond with valid JSON containing "title" and "description" fields, no markdown.',
	];

	if (templateContent) {
		basePrompt.push(
			`Use the following pull request template as the base for the description. `,
			`Fill in the template sections with appropriate content based on the code changes. `,
			`Preserve the template structure and formatting, only fill in the content sections.\n\n`,
			`Template:\n${templateContent}`
		);
	}

	if (customInstructions) {
		basePrompt.push(`Additional instructions: ${customInstructions}`);
	}

	return basePrompt.join(' ');
}

export function buildUserPrompt(
	currentTitle: string,
	currentDescription: string,
	diffs: Array<{ filename: string; status: string; patch: string }>,
	includeFileList: boolean
): string {
	let prompt = `Current PR Title: ${currentTitle}\n\n`;
	prompt += `Current PR Description:\n${currentDescription || '(No description)'}\n\n`;

	if (includeFileList) {
		const fileList = diffs.map((d) => `${d.status}: ${d.filename}`).join('\n');
		prompt += `Changed Files:\n${fileList}\n\n`;
	}

	prompt += 'Code Changes:\n';
	diffs.forEach((diff, index) => {
		prompt += `\n--- File ${index + 1}: ${diff.filename} (${diff.status}) ---\n`;
		prompt += diff.patch.substring(0, 2000); // Limit to prevent token overflow
		if (diff.patch.length > 2000) {
			prompt += '\n... (truncated)';
		}
	});

	prompt +=
		'\n\nGenerate an improved title and description that helps reviewers:\n' +
		'- Understand what changed and why\n' +
		'- Identify the scope and impact of changes\n' +
		'- Spot potential issues or side effects\n' +
		'- Determine if testing is adequate\n' +
		'- Approve or request changes with confidence';

	return prompt;
}
