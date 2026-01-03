import * as core from '@actions/core';
import OpenAI from 'openai';
import type { CommentContext } from './types';
import { createSystemPrompt, buildUserPrompt } from './prompts';

// ============================================================================
// Reply Generation Functions
// ============================================================================

/**
 * Generate an AI reply to a developer's question
 */
export async function generateReply(
	openai: OpenAI,
	context: CommentContext,
	model: string,
	customPrompt?: string
): Promise<string> {
	try {
		core.info('Generating AI reply...');

		const systemPrompt = customPrompt || createSystemPrompt();
		const userPrompt = buildUserPrompt(context);

		const completion = await openai.chat.completions.create({
			model,
			messages: [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: userPrompt,
				},
			],
			temperature: 0.7,
			max_tokens: 1000,
		});

		const replyBody = completion.choices[0]?.message?.content || '';

		if (!replyBody) {
			core.warning('AI returned empty response');
			return "I apologize, but I wasn't able to generate a helpful response. Could you please rephrase your question?";
		}

		core.info(`Generated reply (${replyBody.length} characters)`);
		return replyBody;
	} catch (error) {
		core.error(`Failed to generate AI reply: ${error}`);
		throw new Error(`AI reply generation failed: ${error}`);
	}
}

/**
 * Validate the generated reply
 */
export function validateReply(replyBody: string): boolean {
	if (!replyBody || replyBody.trim().length === 0) {
		core.warning('Reply body is empty');
		return false;
	}

	if (replyBody.length > 5000) {
		core.warning('Reply is too long (>5000 characters)');
		return false;
	}

	return true;
}

