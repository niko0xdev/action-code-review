export function createSystemPrompt(customInstructions: string, templateContent?: string): string {
	const basePrompt = [
		'You are an expert software engineer and technical writer.',
		'Your task is to improve pull request titles and descriptions to be clear, concise, and informative.',
		'The title should follow conventional commit format when appropriate and clearly indicate the change.',
		'The description should include: what changed, why it changed, and any relevant context for reviewers.',
		'Focus on clarity and completeness while being concise.',
		'Always respond with valid JSON containing "title" and "description" fields.',
		'Do not include markdown code fences in your response.',
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
		'\n\nPlease provide an improved title and description for this pull request.';

	return prompt;
}
