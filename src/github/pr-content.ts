import * as core from '@actions/core';
import { extractJsonBlock } from '../llm/openai-compatible.js';
import { redactSecrets } from '../security/redaction/redactor.js';

export interface PrContentOctokit {
	rest: {
		pulls: {
			get(args: unknown): Promise<{
				data: { title: string; body?: string | null; head: { sha: string } };
			}>;
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
	expectedSnapshot: PrContentSnapshot;
}

export interface PrContentSnapshot {
	headSha: string;
	title: string;
	body: string;
}

export class PrContentConflictError extends Error {
	constructor() {
		super('PR content or head changed during generation; update skipped.');
		this.name = 'PrContentConflictError';
	}
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

const DESCRIPTION_ANCHOR =
	/<!-- AI will fill this section with a description of what changed -->/;

function applyTemplate(description: string, templateContent?: string): string {
	// Without the anchor there is nothing to fill; returning the template would
	// discard the generated text, so keep the AI description as written.
	if (
		!templateContent ||
		description.includes('## Description') ||
		!DESCRIPTION_ANCHOR.test(templateContent)
	)
		return description;
	let result = templateContent.replace(DESCRIPTION_ANCHOR, () => description);
	if (description.includes('## How Has This Been Tested')) {
		const match = description.match(
			/## How Has This Been Tested\s*\n([\s\S]*?)(?=\n##|\n\n|$)/
		);
		if (match) {
			result = result.replace(
				/<!-- AI will fill this section with testing information -->/,
				() => match[1].trim()
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
	options: Pick<
		PrContentUpdateOptions,
		'response' | 'templateContent' | 'expectedSnapshot'
	>
): Promise<void> {
	const parsed = parseUpdate(options.response);
	// The description is written to the PR: a secret echoed from the diff must not be.
	const update = { ...parsed, title: redactSecrets(parsed.title) };
	const description = redactSecrets(
		applyTemplate(parsed.description, options.templateContent)
	);
	const current = await octokit.rest.pulls.get({
		owner,
		repo,
		pull_number: prNumber,
	});
	const expected = options.expectedSnapshot;
	if (
		current.data.head.sha !== expected.headSha ||
		current.data.title !== expected.title ||
		(current.data.body ?? '') !== expected.body
	) {
		throw new PrContentConflictError();
	}
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
