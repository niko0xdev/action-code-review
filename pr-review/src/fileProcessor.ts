import * as core from '@actions/core';
import OpenAI from 'openai';
import { buildUserPrompt, createSystemPrompt } from './prompts';
import { parseReviewResponse } from './reviewParser';
import type { ReviewComment } from './reviewParser';
import type { FileData, OctokitType, ContextFile } from './types';
import { parseImports } from './importParser';
import { resolveImportPaths } from './dependencyResolver';

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

		const decoded = Buffer.from(response.data.content, 'base64').toString(
			'utf-8'
		);
		// Return empty string if content is empty (e.g., empty file)
		return decoded;
	} catch (error) {
		console.error(`Error fetching file content for sha ${sha}:`, error);
		return null;
	}
}

/**
 * Build context files list with smart import-based selection
 */
export async function buildContextFiles(
	changedFiles: FileData[],
	knownFiles: string[],
	octokit: OctokitType,
	owner: string,
	repo: string,
	includeFullContent: boolean,
	maxContextChars: number
): Promise<ContextFile[]> {
	if (!includeFullContent) {
		return [];
	}

	const contextFiles: ContextFile[] = [];
	const visited = new Set<string>();
	let totalChars = 0;

	for (const file of changedFiles) {
		if (!file.patch || !file.sha) continue;

		// Fetch changed file content
		const content = await fetchFileContent(octokit, owner, repo, file.sha);
		if (!content) continue;

		// Add changed file to context if within limits
		if (!visited.has(file.filename)) {
			visited.add(file.filename);

			if (totalChars + content.length <= maxContextChars) {
				contextFiles.push({
					path: file.filename,
					content,
					type: 'changed',
				});
				totalChars += content.length;
			}
		}

		// Parse and resolve imports from the file
		const imports = parseImports(content, file.filename);
		const resolvedPaths = await resolveImportPaths(imports, file.filename, {
			octokit,
			owner,
			repo,
			knownFiles,
		});

		// Fetch and add dependency files
		for (const depPath of resolvedPaths) {
			if (visited.has(depPath)) continue;

			// Find the file in known files to get its SHA
			const depFile = knownFiles.find((f) => f === depPath);
			if (!depFile) continue;

			// Try to fetch the dependency file content
			// Note: We don't have SHA for dependency files from PR list,
			// so we'll skip them for now. In a future enhancement,
			// we could fetch file metadata to get SHA.
			continue;
		}
	}

	return contextFiles;
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
	contextFiles: ContextFile[]
): Promise<{ comments: ReviewComment[]; summary: string }> {
	if (!file.patch) {
		return { comments: [], summary: '' };
	}

		try {
		// Find context for this file (if any)
		const fileContext = contextFiles.find(
			(ctx) => ctx.path === file.filename && ctx.type === 'changed'
		);
		const fullContent = fileContext?.content;

		core.info(`Reviewing ${file.filename} with ${fullContent ? 'full content' : 'diff only'}`);
		core.debug(`Patch length: ${file.patch?.length} characters`);

		// Calculate approximate token usage
		const promptContent = buildUserPrompt(
			file.filename,
			file.patch,
			reviewFocus,
			fullContent,
			contextFiles.filter((ctx) => ctx.path !== file.filename)
		);
		core.debug(`User prompt length: ${promptContent.length} characters`);

		const completion = await openai.chat.completions.create({
			model: openaiModel,
			messages: [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: promptContent,
				},
			],
			max_tokens: 4000,  // Increased from 1500 to avoid truncation
			temperature: 0.3,
		});

		const reviewText = completion.choices[0]?.message?.content;
		if (!reviewText) {
			core.warning(`No review text generated for ${file.filename}`);
			return { comments: [], summary: '' };
		}

		// Log raw AI response for debugging
		core.info(`\n========== RAW AI RESPONSE for ${file.filename} ==========`);
		core.info(reviewText);
		core.info(`========== END RAW AI RESPONSE (${reviewText.length} chars) ==========\n`);

		const parsed = parseReviewResponse(reviewText, file.filename);
		core.info(`Parsed ${parsed.comments.length} comments from AI response`);

		if (parsed.comments.length === 0) {
			core.warning(`No inline comments found in AI response for ${file.filename}`);
		}

		// Summary with just count of issues
		const issueCount = parsed.comments.length;
		const summary =
			issueCount > 0
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
					return (
						file.filename.startsWith(normalizedDir + '/') ||
						file.filename === normalizedDir
					);
				});
			}

			return true;
		})
		.slice(0, maxFiles);
}
