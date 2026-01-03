import OpenAI from 'openai';
import {
	buildUserPrompt,
	createSystemPrompt,
} from './prompts';
import { parseReviewResponse } from './reviewParser';
import type { ReviewComment } from './reviewParser';
import type { FileData, OctokitType } from './types';

// ============================================================================
// File Content Fetching
// ============================================================================

export async function fetchFileContent(
	octokit: OctokitType,
	owner: string,
	repo: string,
	sha: string
): Promise<string | null> {
	try {
		const response = await octokit.rest.git.getBlob({
			owner,
			repo,
			file_sha: sha,
		});

		if (response.data.content === null || response.data.content === undefined) {
			return null;
		}

		const decoded = Buffer.from(response.data.content, 'base64').toString('utf-8');
		// Return empty string if content is empty (e.g., empty file)
		return decoded;
	} catch (error) {
		console.error(`Error fetching file content for sha ${sha}:`, error);
		return null;
	}
}

// ============================================================================
// File Processing
// ============================================================================

export async function processFile(
	file: FileData,
	openai: OpenAI,
	openaiModel: string,
	systemPrompt: string,
	reviewFocus: string,
	octokit: OctokitType,
	owner: string,
	repo: string,
	includeFullContent: boolean
): Promise<{ comments: ReviewComment[]; summary: string }> {
	if (!file.patch) {
		return { comments: [], summary: '' };
	}

	try {
		let fullContent: string | undefined;

		if (includeFullContent && file.sha) {
			const content = await fetchFileContent(octokit, owner, repo, file.sha);
			if (content) {
				fullContent = content;
			}
		}

		const completion = await openai.chat.completions.create({
			model: openaiModel,
			messages: [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: buildUserPrompt(
						file.filename,
						file.patch,
						reviewFocus,
						fullContent
					),
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

		// Summary with just count of issues
		const issueCount = parsed.comments.length;
		const summary = issueCount > 0
			? `**${issueCount} issue${issueCount > 1 ? 's' : ''} found** in ${file.filename}`
			: '';

		return {
			comments: parsed.comments,
			summary,
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

