import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveEngineConfig } from './adapter/engine-config.js';
import {
	type PrReviewEngineOptions,
	mapPrReviewInputs,
} from './adapter/legacy-inputs.js';
import { preparePiRuntimeConfig } from './adapter/runtime.js';
import { prioritizeFiles } from './context/files.js';
import { fetchPrContext } from './context/pr.js';
import { publishReview } from './github/review.js';
import type { PublisherOctokit } from './github/review.js';
import { PiHarness } from './harness/pi.js';
import { REVIEW_OPTION_DEFAULTS } from './llm/config.js';
import { resolveProfiles, rulesForProfiles } from './profiles/index.js';
import { runReview } from './review/reviewer.js';

function positiveTimeout(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseArgs(args: string[]): { action: string } {
	return { action: args[0] === 'pr-content' ? 'pr-content' : 'pr-review' };
}

export async function main(argv: string[]): Promise<void> {
	try {
		const options = parseArgs(argv);
		core.info(`[review] V2 initialized (action: ${options.action})`);
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
		const octokit = github.getOctokit(
			legacyOptions.githubToken
		) as unknown as PublisherOctokit;
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
		try {
			process.env.PI_CONFIG_DIR = runtimeConfig.configDir;
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
			await publishReview(octokit as unknown as PublisherOctokit, {
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

function applyLegacyFilters(
	filenames: string[],
	options: { excludePatterns: string[]; includeDirs?: string[] }
): string[] {
	const toRegex = (pattern: string) =>
		new RegExp(
			pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
		);
	return filenames.filter((filename) => {
		if (
			options.excludePatterns.some((pattern) => toRegex(pattern).test(filename))
		)
			return false;
		if (options.includeDirs?.length)
			return options.includeDirs.some(
				(dir) => filename.startsWith(`${dir}/`) || filename === dir
			);
		return true;
	});
}
