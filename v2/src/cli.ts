import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveEngineConfig } from './adapter/engine-config.js';
import {
	type PrContentEngineOptions,
	type PrReviewEngineOptions,
	mapPrContentInputs,
	mapPrReviewInputs,
} from './adapter/legacy-inputs.js';
import { preparePiRuntimeConfig } from './adapter/runtime.js';
import { prioritizeFiles } from './context/files.js';
import { fetchPrContext } from './context/pr.js';
import { updatePrContent } from './github/pr-content.js';
import { buildJobSummary, publishReview } from './github/review.js';
import type { PublisherOctokit } from './github/review.js';
import { PiHarness } from './harness/pi.js';
import { REVIEW_OPTION_DEFAULTS } from './llm/config.js';
import { OpenAiCompatibleProvider } from './llm/openai-compatible.js';
import {
	buildUserPrompt,
	createSystemPrompt,
} from './llm/prompts/pr-content.js';
import type { ChatCompletion, ChatMessage } from './llm/provider.js';
import { resolveProfiles, rulesForProfiles } from './profiles/index.js';
import { runReview } from './review/reviewer.js';

function positiveTimeout(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function recordArgs(args: unknown): Record<string, unknown> {
	if (!args || typeof args !== 'object')
		throw new Error('Invalid request arguments');
	return args as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== 'string') throw new Error(`Missing ${key}`);
	return value;
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
	const value = args[key];
	if (typeof value !== 'number') throw new Error(`Missing ${key}`);
	return value;
}

function repositoryArgs(args: Record<string, unknown>) {
	return {
		owner: requiredString(args, 'owner'),
		repo: requiredString(args, 'repo'),
		pull_number: requiredNumber(args, 'pull_number'),
	};
}

function toPublisherOctokit(
	client: ReturnType<typeof github.getOctokit>
): PublisherOctokit {
	const pulls = {
		get: (args: unknown) =>
			client.rest.pulls.get(repositoryArgs(recordArgs(args))),
		update: (args: Record<string, unknown>) =>
			client.rest.pulls.update({
				...repositoryArgs(args),
				title: requiredString(args, 'title'),
				body: requiredString(args, 'body'),
			}),
		listFiles: (args: Record<string, unknown>) =>
			client.rest.pulls.listFiles({
				...repositoryArgs(args),
				page: requiredNumber(args, 'page'),
				per_page: requiredNumber(args, 'per_page'),
			}),
		createReview: (args: Record<string, unknown>) => {
			const event = requiredString(args, 'event');
			if (!['REQUEST_CHANGES', 'COMMENT', 'APPROVE'].includes(event))
				throw new Error('Invalid event');
			if (!Array.isArray(args.comments)) throw new Error('Missing comments');
			return client.rest.pulls.createReview({
				...repositoryArgs(args),
				commit_id: requiredString(args, 'commit_id'),
				event: event as 'REQUEST_CHANGES' | 'COMMENT' | 'APPROVE',
				comments: args.comments as Array<{
					path: string;
					line?: number;
					body: string;
					side?: string;
				}>,
			});
		},
		createReviewComment: (args: Record<string, unknown>) =>
			client.rest.pulls.createReviewComment({
				...repositoryArgs(args),
				body: requiredString(args, 'body'),
				commit_id: requiredString(args, 'commit_id'),
				path: requiredString(args, 'path'),
				line: requiredNumber(args, 'line'),
				side: (() => {
					const side = requiredString(args, 'side');
					if (side !== 'RIGHT' && side !== 'LEFT')
						throw new Error('Invalid side');
					return side;
				})(),
			}),
		createReplyForReviewComment: (args: {
			owner: string;
			repo: string;
			pull_number: number;
			comment_id: number;
			body: string;
		}) => client.rest.pulls.createReplyForReviewComment(args),
		getReviewComment: (args: Record<string, unknown>) =>
			client.rest.pulls.getReviewComment({
				...repositoryArgs(args),
				comment_id: requiredNumber(args, 'comment_id'),
			}),
		listReviews: async (args: Record<string, unknown>) => {
			const response = await client.rest.pulls.listReviews({
				...repositoryArgs(args),
				page: requiredNumber(args, 'page'),
				per_page: requiredNumber(args, 'per_page'),
			});
			return {
				data: response.data.map((review) => ({
					id: review.id,
					user: review.user ? { login: review.user.login ?? undefined } : null,
				})),
			};
		},
		listCommentsForReview: async (args: Record<string, unknown>) => {
			const response = await client.rest.pulls.listCommentsForReview({
				...repositoryArgs(args),
				review_id: requiredNumber(args, 'review_id'),
				page: requiredNumber(args, 'page'),
				per_page: requiredNumber(args, 'per_page'),
			});
			return {
				data: response.data.map((comment) => ({
					body: comment.body ?? null,
					pull_request_url: comment.pull_request_url ?? null,
					user: comment.user
						? { login: comment.user.login ?? undefined }
						: null,
				})),
			};
		},
	};
	return {
		rest: {
			pulls,
			issues: {
				createComment: (args: Record<string, unknown>) =>
					client.rest.issues.createComment({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						issue_number: requiredNumber(args, 'issue_number'),
						body: requiredString(args, 'body'),
					}),
			},
			users: {
				getAuthenticated: () => client.rest.users.getAuthenticated(),
			},
		},
		users: { getAuthenticated: () => client.rest.users.getAuthenticated() },
	};
}

export function parseArgs(args: string[]): { action: string } {
	return {
		action:
			(args[0] ?? 'pr-review') === 'pr-content' ? 'pr-content' : 'pr-review',
	};
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
	let completion: ChatCompletion;
	try {
		completion = await complete(options.maxTokens || 4096);
	} catch (error) {
		core.warning(
			`First AI call failed (${error instanceof Error ? error.message : String(error)}); retrying with max_tokens=4096`
		);
		completion = await complete(4096);
	}
	if (!completion.content || completion.finishReason === 'length') {
		core.warning(
			'AI response truncated or empty; retrying with max_tokens=4096'
		);
		completion = await complete(4096);
	}
	try {
		await updatePrContent(octokit, repoInfo.owner, repoInfo.repo, prNumber, {
			response: completion.content,
			templateContent,
		});
	} catch (error) {
		core.warning(
			`First parse failed (${error instanceof Error ? error.message : String(error)}); retrying with max_tokens=4096`
		);
		completion = await complete(4096);
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

export async function main(argv: string[]): Promise<void> {
	try {
		const options = parseArgs(argv);
		core.info(`[review] V2 initialized (action: ${options.action})`);
		if (options.action === 'pr-content') {
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
			return;
		}
		const context = github.context;
		if (!context.payload.pull_request) {
			core.setFailed('This action only runs on pull requests');
			return;
		}

		const legacyOptions: PrReviewEngineOptions = mapPrReviewInputs({
			'github-token': core.getInput('github-token'),
			'openai-api-key': core.getInput('openai-api-key'),
			'openai-base-url': core.getInput('openai-base-url'),
			'openai-model': core.getInput('openai-model'),
			'review-prompt': core.getInput('review-prompt'),
			'max-files': core.getInput('max-files'),
			'exclude-patterns': core.getInput('exclude-patterns'),
			'include-dir': core.getInput('include-dir'),
			'auto-approve-when-resolved': core.getInput('auto-approve-when-resolved'),
			'min-severity': core.getInput('min-severity'),
			'block-on-issues': core.getInput('block-on-issues'),
			'include-full-content': core.getInput('include-full-content'),
			'max-context-chars': core.getInput('max-context-chars'),
		});
		const llmConfig = resolveEngineConfig(legacyOptions);
		const octokit = toPublisherOctokit(
			github.getOctokit(legacyOptions.githubToken)
		);
		const prNumber = context.payload.pull_request.number;
		const repoInfo = { owner: context.repo.owner, repo: context.repo.repo };
		const reviewContext = await fetchPrContext(octokit, repoInfo, prNumber);
		reviewContext.repositoryPath =
			process.env.GITHUB_WORKSPACE || process.cwd();
		const filtered = applyLegacyFilters(
			reviewContext.diff.files.map((f) => f.filename),
			legacyOptions
		);
		const maxFiles = Math.min(
			legacyOptions.maxFiles,
			Number.parseInt(
				process.env.AI_REVIEW_MAX_FILES ||
					`${REVIEW_OPTION_DEFAULTS.aiReviewMaxFiles}`,
				10
			)
		);
		reviewContext.diff.files = prioritizeFiles(
			reviewContext.diff.files.filter(
				(f) => filtered.includes(f.filename) && Boolean(f.patch)
			),
			maxFiles
		);
		if (reviewContext.diff.files.length === 0) {
			core.info('[review] No files to review after filtering');
			return;
		}

		const profiles = resolveProfiles(
			reviewContext.repositoryPath,
			process.env.AI_REVIEW_PROFILE
		);
		reviewContext.profiles = profiles;
		const previousConfigDir = process.env.PI_CONFIG_DIR;
		const runtimeConfig = await preparePiRuntimeConfig(llmConfig);
		process.env.PI_CONFIG_DIR = runtimeConfig.configDir;
		try {
			const harness = new PiHarness({
				timeoutMs: positiveTimeout(
					process.env.AI_REVIEW_PI_TIMEOUT_MS,
					15 * 60_000
				),
				model: llmConfig.model,
				apiKey: llmConfig.apiKey,
				includeFullContent: legacyOptions.includeFullContent,
				maxContextChars: legacyOptions.maxContextChars,
				extraRules: rulesForProfiles(profiles),
				provider: llmConfig.provider,
			});
			const result = await runReview(reviewContext, harness, {
				minConfidence: Number.parseFloat(
					process.env.AI_REVIEW_MIN_CONFIDENCE || '0.8'
				),
				extraRules: [legacyOptions.reviewPrompt, rulesForProfiles(profiles)]
					.filter(Boolean)
					.join('\n\n'),
				minSeverity: legacyOptions.minSeverity,
			});
			await publishReview(octokit, {
				owner: repoInfo.owner,
				repo: repoInfo.repo,
				prNumber,
				headSha: reviewContext.pullRequest.headSha,
				result,
				blockOnIssues: legacyOptions.blockOnIssues,
				minSeverity: legacyOptions.minSeverity,
			});
			core.setOutput(
				'review-summary',
				`${result.filesReviewed.length} files reviewed, ${result.findings.length} issues found`
			);
		} finally {
			await runtimeConfig.cleanup();
			if (previousConfigDir === undefined)
				Reflect.deleteProperty(process.env, 'PI_CONFIG_DIR');
			else process.env.PI_CONFIG_DIR = previousConfigDir;
		}
	} catch (error) {
		core.setFailed(
			`Action failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export function applyLegacyFilters(
	filenames: string[],
	options: { excludePatterns: string[]; includeDirs?: string[] }
): string[] {
	const excludeRegexes = options.excludePatterns.map(
		(pattern) =>
			new RegExp(
				`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
			)
	);
	return filenames.filter((filename) => {
		if (excludeRegexes.some((regex) => regex.test(filename))) return false;
		if (options.includeDirs?.length)
			return options.includeDirs.some(
				(dir) => filename.startsWith(`${dir}/`) || filename === dir
			);
		return true;
	});
}
