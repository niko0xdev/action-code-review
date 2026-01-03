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
	maxFiles: number,
	includeDir?: string
): FileData[] {
	const excludeList = excludePatterns.split(',').map((p) => p.trim());
	const includeDirs = includeDir
		? includeDir.split(',').map((p) => p.trim())
		: null;

	return files
		.filter((file) => {
			// Apply exclude patterns filter
			const isExcluded = excludeList.some((pattern) => {
				const regex = new RegExp(pattern.replace(/\*/g, '.*'));
				return regex.test(file.filename);
			});

			if (isExcluded) return false;

			// Apply include directory filter if specified
			if (includeDirs) {
				return includeDirs.some((dir) => {
					const normalizedDir = dir.startsWith('/') ? dir.slice(1) : dir;
					return file.filename.startsWith(normalizedDir + '/') || file.filename === normalizedDir;
				});
			}

			return true;
		})
		.slice(0, maxFiles);
}

