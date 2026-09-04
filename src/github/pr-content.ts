import * as core from '@actions/core';
import { extractJsonBlock } from '../llm/openai-compatible.js';

export interface PrContentOctokit {
	rest: {
		pulls: {
			get(
				args: unknown
			): Promise<{ data: { title: string; body?: string | null } }>;
			listFiles(args: Record<string, unknown>): Promise<{ data: unknown[] }>;
			update(args: Record<string, unknown>): Promise<{ data: unknown }>;
		};
	};
}

export interface PrContentUpdateOptions {
	octokit: PrContentOctokit;
	owner: string;
	repo: string;
	prNumber: number;
	response: string;
	templateContent?: string;
}

function parseUpdate(response: string): { title: string; description: string } {
	const parsed = extractJsonBlock(response);
	if (
		!parsed ||
		typeof parsed.title !== 'string' ||
		typeof parsed.description !== 'string'
	) {
		throw new Error(
			'AI response must contain title and description JSON fields'
		);
	}
	return { title: parsed.title, description: parsed.description };
}

function applyTemplate(description: string, templateContent?: string): string {
	if (!templateContent || description.includes('## Description'))
		return description;
	let result = templateContent.replace(
		/<!-- AI will fill this section with a description of what changed -->/,
		description
	);
	if (description.includes('## How Has This Been Tested')) {
		const match = description.match(
			/## How Has This Been Tested\s*\n([\s\S]*?)(?=\n##|\n\n|$)/
		);
		if (match) {
			result = result.replace(
				/<!-- AI will fill this section with testing information -->/,
				match[1].trim()
			);
		}
	}
	return result;
}

export async function updatePrContent(
	octokit: PrContentOctokit,
	owner: string,
	repo: string,
	prNumber: number,
	options: Pick<PrContentUpdateOptions, 'response' | 'templateContent'>
): Promise<void> {
	const update = parseUpdate(options.response);
	const description = applyTemplate(
		update.description,
		options.templateContent
	);
	const current = await octokit.rest.pulls.get({
		owner,
		repo,
		pull_number: prNumber,
	});
	if (
		current.data.title === update.title &&
		current.data.body === description
	) {
		core.info('No changes needed - PR content is already optimal');
		return;
	}
	await octokit.rest.pulls.update({
		owner,
		repo,
		pull_number: prNumber,
		title: update.title,
		body: description,
	});
	core.info(`Updated PR title: "${update.title}"`);
	core.info(`Updated PR description: ${description.substring(0, 100)}...`);
}

export function parsePrContentResponse(response: string): {
	title: string;
	description: string;
} {
	try {
		return parseUpdate(response);
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
		throw error;
	}
}
