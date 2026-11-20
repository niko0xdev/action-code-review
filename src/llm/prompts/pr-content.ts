import { escapeControlChars, fenced } from '../../shared/prompt-safety.js';

export function createSystemPrompt(
	customInstructions?: string,
	templateContent?: string,
	diagram = false
): string {
	const prompt = [
		'You are an expert software engineer and technical writer.',
		'Your task is to improve pull request titles and descriptions to be clear, concise, and informative.',
		'The title should follow conventional commit format when appropriate and clearly indicate the change.',
		'The description should include: what changed, why it changed, and any relevant context for reviewers.',
		'Focus on clarity and completeness while being concise.',
		'Always respond with valid JSON containing "title" and "description" fields.',
		'Do not include markdown code fences in your response.',
	];
	if (diagram) {
		prompt.push(
			'Also return a "diagram" field: a short Mermaid sequenceDiagram (plain text starting with "sequenceDiagram", at most 30 lines, no code fences) showing the main runtime interaction this change adds or modifies.',
			'Allowed statements, one per line: "participant P as label", "actor P as label", "A->>B: text", "A-->>B: text", "A->B: text", "A-->B: text", "A->>+B: text" (activates B), "B-->>-A: text" (deactivates B, only after it was activated), "Note over A: text", "Note over A, B: text", "Note left of A: text", "Note right of A: text", "alt label", "else label", "opt label", "loop label", "end", and "autonumber".',
			'Participant names match [A-Za-z_][A-Za-z0-9_]* and are not Mermaid keywords such as end, alt, opt, loop, note, or title; put a name with dots, hyphens, or spaces in the label of a participant P as label declaration.',
			'Text and labels must not contain a semicolon, a backtick, a backslash, %%, a < followed by a letter or slash, an & followed by a letter or #, a URL, or HTML; never use click, link, links, or %%{init}%% directives or comments.',
			'Return an empty string when the change has no meaningful interaction flow, and never repeat the diagram in the description.'
		);
	}
	if (templateContent) {
		prompt.push(
			'Use the following pull request template as the base for the description.',
			'Fill in the template sections with appropriate content based on the code changes.',
			'Preserve the template structure and formatting, only fill in the content sections.',
			`Template:\n${templateContent}`
		);
	}
	if (customInstructions)
		prompt.push(`Additional instructions: ${customInstructions}`);
	return prompt.join(' ');
}

export function buildUserPrompt(
	currentTitle: string,
	currentDescription: string,
	diffs: Array<{ filename: string; status: string; patch: string }>,
	includeFileList: boolean
): string {
	let prompt = `Current PR Title: ${escapeControlChars(currentTitle)}\n\n`;
	prompt += `Current PR Description:\n${currentDescription ? fenced(currentDescription) : '(No description)'}\n\n`;
	if (includeFileList) {
		prompt += `Changed Files:\n${diffs.map((d) => `${escapeControlChars(d.status)}: ${escapeControlChars(d.filename)}`).join('\n')}\n\n`;
	}
	prompt += 'Code Changes:';
	diffs.forEach((diff, index) => {
		prompt += `\n\n--- File ${index + 1}: ${escapeControlChars(diff.filename)} (${escapeControlChars(diff.status)}) ---\n`;
		const excerpt = diff.patch.substring(0, 2000);
		prompt += fenced(
			diff.patch.length > 2000 ? `${excerpt}\n... (truncated)` : excerpt
		);
	});
	return `${prompt}\n\nPlease provide an improved title and description for this pull request.`;
}
