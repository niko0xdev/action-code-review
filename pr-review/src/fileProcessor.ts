import OpenAI from 'openai';
import {
	buildUserPrompt,
	createSystemPrompt,
} from './prompts';
import { parseReviewResponse } from './reviewParser';
import type { ReviewComment } from './reviewParser';
import type { FileData } from './types';

// ============================================================================
// File Processing
// ============================================================================

export async function processFile(
	file: FileData,
	openai: OpenAI,
	openaiModel: string,
	systemPrompt: string,
	reviewFocus: string
): Promise<{ comments: ReviewComment[]; summary: string }> {
	if (!file.patch) {
		return { comments: [], summary: '' };
	}

	try {
		const completion = await openai.chat.completions.create({
			model: openaiModel,
			messages: [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: buildUserPrompt(file.filename, file.patch, reviewFocus),
				},
			],
			max_tokens: 1500,
			temperature: 0.3,
		});

		const reviewText = completion.choices[0]?.message?.content;
		if (!reviewText) {
			return { comments: [], summary: '' };
		}

		const parsed = parseReviewResponse(reviewText, file.filename);

		return {
			comments: parsed.comments,
			summary: `## ${file.filename}\n\n${parsed.summary}\n\n`,
		};
	} catch (error) {
		console.error(`Error reviewing ${file.filename}:`, error);
		return { comments: [], summary: '' };
	}
}

export function filterFiles(
	files: FileData[],
	excludePatterns: string,
	maxFiles: number
): FileData[] {
	const excludeList = excludePatterns.split(',').map((p) => p.trim());
	return files
		.filter((file) => {
			return !excludeList.some((pattern) => {
				const regex = new RegExp(pattern.replace(/\*/g, '.*'));
				return regex.test(file.filename);
			});
		})
		.slice(0, maxFiles);
}

