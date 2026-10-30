import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveEngineConfig } from '../adapter/engine-config.js';
import {
	type PrContentEngineOptions,
	mapPrContentInputs,
} from '../adapter/legacy-inputs.js';
import { fetchPrContext } from '../context/pr.js';
import { updatePrContent } from '../github/pr-content.js';
import { buildJobSummary } from '../github/review.js';
import { OpenAiCompatibleProvider } from '../llm/openai-compatible.js';
import {
	buildUserPrompt,
	createSystemPrompt,
} from '../llm/prompts/pr-content.js';
import type { ChatCompletion, ChatMessage } from '../llm/provider.js';
import { toPublisherOctokit } from './octokit.js';

const DEFAULT_PR_CONTENT_MAX_TOKENS = 4096;
const PR_CONTENT_RETRY_CEILING = 32_768;

/**
 * Retry budget after a truncated, empty, or unparseable answer. Reasoning
 * models spend output tokens on thinking before the JSON, so repeating the
 * same budget fails the same way; double it up to a ceiling.
 */
export function escalateMaxTokens(current: number): number {
	return Math.min(current * 2, PR_CONTENT_RETRY_CEILING);
}

async function runPrContent(options: PrContentEngineOptions): Promise<void> {
	const started = performance.now();
	const context = github.context;
	const prNumber = context.payload.pull_request?.number;
	if (!prNumber) {
		core.setFailed('This action only runs on pull requests');
		return;
	}
	const repoInfo = { owner: context.repo.owner, repo: context.repo.repo };
	const client = github.getOctokit(options.githubToken);
	const octokit = toPublisherOctokit(client);
	const prContext = await fetchPrContext(octokit, repoInfo, prNumber);
	let templateContent = '';
	try {
		const template = await client.rest.repos.getContent({
			...repoInfo,
			path: options.templatePath,
		});
		if (
			'content' in template.data &&
			typeof template.data.content === 'string'
		) {
			templateContent = Buffer.from(template.data.content, 'base64').toString(
				'utf8'
			);
		}
	} catch {
		// Missing template is valid and matches V1 behavior.
	}
	const config = resolveEngineConfig(options);
	const provider = new OpenAiCompatibleProvider(config);
	const diffs = prContext.diff.files
		.filter((file) => file.patch)
		.map((file) => ({
			filename: file.filename,
			status: file.status,
			patch: file.patch ?? '',
		}));
	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: createSystemPrompt(options.customInstructions, templateContent),
		},
		{
			role: 'user',
			content: buildUserPrompt(
				prContext.pullRequest.title,
				prContext.pullRequest.body,
				diffs,
				options.includeFileList
			),
		},
	];
	const complete = (maxOutputTokens: number) =>
		provider.complete(messages, { temperature: 0.3, maxOutputTokens });
	let budget = options.maxTokens || DEFAULT_PR_CONTENT_MAX_TOKENS;
	// Transient failures (429/5xx/network) are retried inside the provider.
	let completion: ChatCompletion = await complete(budget);
	if (!completion.content || completion.finishReason === 'length') {
		budget = escalateMaxTokens(budget);
		core.warning(
			`AI response truncated or empty; retrying with max_tokens=${budget}`
		);
		completion = await complete(budget);
	}
	try {
		await updatePrContent(octokit, repoInfo.owner, repoInfo.repo, prNumber, {
			response: completion.content,
			templateContent,
		});
	} catch (error) {
		budget = escalateMaxTokens(budget);
		core.warning(
			`First parse failed (${error instanceof Error ? error.message : String(error)}); retrying with max_tokens=${budget}`
		);
		completion = await complete(budget);
		await updatePrContent(octokit, repoInfo.owner, repoInfo.repo, prNumber, {
			response: completion.content,
			templateContent,
		});
	}
	const durationMs = performance.now() - started;
	const summary = `${buildJobSummary({
		model: options.model,
		durationMs,
		filesReviewed: diffs.map((diff) => diff.filename),
		result: {
			findings: [],
			counts: { critical: 0, high: 0, medium: 0, low: 0 },
			risk: 'none',
		},
	})}
- **Token usage:** ${completion.usage ? `${completion.usage.inputTokens} input / ${completion.usage.outputTokens} output` : 'n/a'}
- **Status:** updated`;
	core.info(summary);
	await core.summary.addRaw(summary).write();
	core.setOutput('pr-content-summary', summary);
}

/** Reads the `pr-content` action inputs and runs the PR-content flow. */
export async function runPrContentAction(): Promise<void> {
	const contentOptions = mapPrContentInputs({
		'github-token': core.getInput('github-token'),
		'openai-api-key': core.getInput('openai-api-key'),
		'openai-base-url': core.getInput('openai-base-url'),
		'openai-model': core.getInput('openai-model'),
		'max-tokens': core.getInput('max-tokens'),
		'include-file-list': core.getInput('include-file-list'),
		'custom-instructions': core.getInput('custom-instructions'),
		'template-path': core.getInput('template-path'),
	});
	await runPrContent(contentOptions);
}
