import type { CommentContext } from './types';

// ============================================================================
// System Prompts
// ============================================================================

function createSystemPrompt(): string {
	return [
		'You are a helpful code review assistant answering developer questions about code review feedback.',
		'Your role is to clarify AI-generated code review comments, explain technical concepts, and provide actionable guidance.',
		'Be concise, direct, and practical. Focus on helping the developer understand and implement the feedback.',
		'Always respond in plain text (no Markdown code fences for the response itself, but you can use markdown within the response).',
	].join(' ');
}

// ============================================================================
// User Prompts
// ============================================================================

function buildUserPrompt(context: CommentContext): string {
	const promptParts: string[] = [];

	// Add PR context
	promptParts.push('PR Context:');
	promptParts.push(
		`- PR #${context.prContext.number}: ${context.prContext.title}`
	);
	promptParts.push(
		`- Repository: ${context.prContext.owner}/${context.prContext.repo}`
	);
	promptParts.push('');

	// Add parent AI comment context
	promptParts.push('Original AI Review Comment:');
	promptParts.push('```');
	promptParts.push(context.parentComment.body);
	promptParts.push('```');
	promptParts.push('');

	// Add file context if available
	if (context.fileContext) {
		promptParts.push('File Context:');
		promptParts.push(`- Path: ${context.fileContext.path}`);
		if (context.fileContext.line) {
			promptParts.push(`- Line: ${context.fileContext.line}`);
		}
		promptParts.push('');

		// Add code snippet if available
		if (context.fileContext.content) {
			promptParts.push('Code Content:');
			promptParts.push('```');
			promptParts.push(context.fileContext.content);
			promptParts.push('```');
			promptParts.push('');
		}
	}

	// Add developer's question
	promptParts.push(
		`Developer Question from @${context.questionComment.userLogin}:`
	);
	promptParts.push('```');
	promptParts.push(context.questionComment.body);
	promptParts.push('```');
	promptParts.push('');

	// Add instructions
	promptParts.push('Instructions:');
	promptParts.push(`1. Answer the developer's question clearly and concisely.`);
	promptParts.push(
		'2. Reference the original AI review comment and code as needed.'
	);
	promptParts.push(
		'3. Provide specific examples or code snippets when helpful.'
	);
	promptParts.push(
		'4. If the question is about a technical concept, explain it simply.'
	);
	promptParts.push('5. Keep your response focused and actionable.');
	promptParts.push('');
	promptParts.push('Please provide your answer:');

	return promptParts.join('\n');
}

// ============================================================================
// Reply Marker
// ============================================================================

function addReplyMarker(replyBody: string): string {
	const marker = '\n\n<!-- ai-reply -->';
	if (replyBody.includes('<!-- ai-reply -->')) {
		return replyBody;
	}
	return `${replyBody}${marker}`;
}

// ============================================================================
// Exports
// ============================================================================

export { createSystemPrompt, buildUserPrompt, addReplyMarker };
