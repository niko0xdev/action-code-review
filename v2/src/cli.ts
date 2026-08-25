import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveEngineConfig } from './adapter/engine-config.js';
import {
	type PrReviewEngineOptions,
	mapPrReviewInputs,
} from './adapter/legacy-inputs.js';
import { preparePiRuntimeConfig } from './adapter/runtime.js';
import { prioritizeFiles } from './context/files.js';
import { type OctokitLike, fetchPrContext } from './context/pr.js';
import { publishReview } from './github/review.js';
import { PiHarness } from './harness/pi.js';
import { resolveProfiles, rulesForProfiles } from './profiles/index.js';
import { runReview } from './review/reviewer.js';

/**
 * V2 engine entry point (pr-review path).
 *
 * The legacy action delegates here through a thin adapter; the public
 * interface is frozen by docs/v1-interface-contract.md. Flow:
 * context → profiles → harness review → validate/dedupe/cap → publish.
 */

export function parseArgs(args: string[]): { action: string } {
	return { action: args[0] === 'pr-content' ? 'pr-content' : 'pr-review' };
}

export async function main(argv: string[]): Promise<void> {
	const options = parseArgs(argv);
	core.info(`[review] V2 initialized (action: ${options.action})`);

	const context = github.context;
	if (!context.payload.pull_request) {
		core.setFailed('This action only runs on pull requests');
		return;
	}

	// Legacy inputs keep their frozen names and defaults.
	const legacyOptions: PrReviewEngineOptions = mapPrReviewInputs({
		'github-token': core.getInput('github-token', { required: true }),
		'openai-api-key': core.getInput('openai-api-key', { required: true }),
		'openai-base-url': core.getInput('openai-base-url'),
		'openai-model': core.getInput('openai-model'),
		'max-files': core.getInput('max-files'),
		'exclude-patterns': core.getInput('exclude-patterns'),
		'include-dir': core.getInput('include-dir'),
		'block-on-issues': core.getInput('block-on-issues'),
	});

	const llmConfig = resolveEngineConfig(legacyOptions);
	core.info(`[review] model: ${llmConfig.model}`);

	const octokit = github.getOctokit(
		legacyOptions.githubToken
	) as unknown as OctokitLike;
	const prNumber = context.payload.pull_request.number;
	const repoInfo = {
		owner: context.repo.owner,
		repo: context.repo.repo,
	};

	const reviewContext = await fetchPrContext(octokit, repoInfo, prNumber);
	reviewContext.repositoryPath = process.env.GITHUB_WORKSPACE || process.cwd();

	const filtered = applyLegacyFilters(
		reviewContext.diff.files.map((f) => f.filename),
		legacyOptions
	);
	if (filtered.length === 0) {
		core.info('[review] No files to review after filtering');
		core.setOutput('review-summary', '0 files reviewed, 0 issues found');
		return;
	}
	reviewContext.diff.files = reviewContext.diff.files.filter(
		(f) => filtered.includes(f.filename) && Boolean(f.patch)
	);

	const prioritized = prioritizeFiles(
		reviewContext.diff.files,
		legacyOptions.maxFiles
	);
	reviewContext.diff.files = prioritized;

	const profiles = resolveProfiles(
		reviewContext.repositoryPath,
		process.env.AI_REVIEW_PROFILE
	);
	reviewContext.profiles = profiles;
	core.info(
		`[review] detected profiles: ${profiles.map((p) => p.id).join(', ') || 'none'}`
	);
	core.info(
		`[review] changed files: ${context.payload.pull_request.number} (${reviewContext.diff.files.length} reviewable)`
	);

	const runtimeConfig = await preparePiRuntimeConfig(llmConfig);
	try {
		const harness = new PiHarness({
			timeoutMs: 15 * 60_000,
			extraRules: rulesForProfiles(profiles),
			provider: llmConfig.provider,
		});
		process.env.PI_CONFIG_DIR = runtimeConfig.configDir;

		const result = await runReview(reviewContext, harness, {
			minConfidence: Number.parseFloat(
				process.env.AI_REVIEW_MIN_CONFIDENCE || '0.8'
			),
			extraRules: rulesForProfiles(profiles),
		});

		core.info(`[review] validated findings: ${result.findings.length}`);

		await publishReview(octokit as never, {
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			prNumber,
			headSha: reviewContext.pullRequest.headSha,
			result,
			blockOnIssues: legacyOptions.blockOnIssues,
		});

		core.setOutput(
			'review-summary',
			`${result.filesReviewed.length} files reviewed, ${result.findings.length} issues found`
		);
		core.info('[review] review published');
	} finally {
		await runtimeConfig.cleanup();
		process.env.PI_CONFIG_DIR = undefined;
	}
}

/** Apply exclude-patterns / include-dir filters with V1 glob semantics. */
function applyLegacyFilters(
	filenames: string[],
	options: { excludePatterns: string[]; includeDirs?: string[] }
): string[] {
	const toRegex = (pattern: string) =>
		new RegExp(
			pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
		);

	return filenames.filter((filename) => {
		const excluded = options.excludePatterns.some((pattern) =>
			toRegex(pattern).test(filename)
		);
		if (excluded) {
			return false;
		}
		if (options.includeDirs && options.includeDirs.length > 0) {
			return options.includeDirs.some(
				(dir) => filename.startsWith(`${dir}/`) || filename === dir
			);
		}
		return true;
	});
}
