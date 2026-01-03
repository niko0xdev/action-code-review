import * as core from '@actions/core';
import * as github from '@actions/github';
import OpenAI from 'openai';
import { DEFAULT_REVIEW_FOCUS, createSystemPrompt } from './prompts';
import { filterCommentsBySeverity } from './reviewParser';
import type { ReviewComment } from './reviewParser';
import type { FileData, ReviewOptions } from './types';
import { processFile, filterFiles, buildContextFiles } from './fileProcessor';
import { getAuthenticatedLogin, postCommentsToPR } from './commentPoster';
import { areAiCommentsResolved, approvePullRequest } from './approvalManager';
import { updateCommentsOnPrChange } from './commentUpdater';

// ============================================================================
// Main Action
// ============================================================================

async function run(): Promise<void> {
	try {
		const githubToken = core.getInput('github-token', { required: true });
		const openaiApiKey = core.getInput('openai-api-key', { required: true });
		const openaiModel = core.getInput('openai-model') || 'gpt-4';
		const reviewFocus = core.getInput('review-prompt') || DEFAULT_REVIEW_FOCUS;
		const maxFiles = Number.parseInt(core.getInput('max-files') || '10');
		const excludePatterns =
			core.getInput('exclude-patterns') || '*.md,*.txt,*.json,*.yml,*.yaml';
		const includeDir = core.getInput('include-dir');
		const autoApproveWhenResolved = core.getBooleanInput(
			'auto-approve-when-resolved'
		);
		const minSeverity = core.getInput('min-severity') || 'critical';
		const blockOnIssues = core.getBooleanInput('block-on-issues');
		const includeFullContent = core.getBooleanInput('include-full-content');
		const maxContextChars = Number.parseInt(
			core.getInput('max-context-chars') || '30000'
		);
		const updateCommentsOnChange = core.getBooleanInput(
			'update-comments-on-change'
		);

		logConfig();

		const octokit = github.getOctokit(githubToken);
		const openai = new OpenAI({
			apiKey: openaiApiKey,
			baseURL: core.getInput('openai-base-url'),
		});

		const context = github.context;
		if (!context.payload.pull_request) {
			core.setFailed('This action only runs on pull requests');
			return;
		}

		const pullRequest = context.payload.pull_request;
		const owner = context.repo.owner;
		const repo = context.repo.repo;
		const prNumber = pullRequest.number;
		const headSha = pullRequest.head?.sha || context.sha;

		core.info(`Processing PR #${prNumber} in ${owner}/${repo}`);

		const { data: files } = await octokit.rest.pulls.listFiles({
			owner,
			repo,
			pull_number: prNumber,
		});

		const filteredFiles = filterFiles(
			files,
			excludePatterns,
			maxFiles,
			includeDir
		);

		if (filteredFiles.length === 0) {
			core.info('No files to review after filtering');
			return;
		}

		core.info(`Reviewing ${filteredFiles.length} files`);

		const systemPrompt = createSystemPrompt();
		const allComments: ReviewComment[] = [];

		// Build context files from imports
		const knownFiles = filteredFiles.map((f) => f.filename);
		const contextFiles = await buildContextFiles(
			filteredFiles,
			knownFiles,
			octokit,
			owner,
			repo,
			includeFullContent,
			maxContextChars
		);

		core.info(`Built context from ${contextFiles.length} files (imports)`);

		for (const file of filteredFiles) {
			core.info(`Reviewing file: ${file.filename}`);

			const { comments, summary } = await processFile(
				file,
				openai,
				openaiModel,
				systemPrompt,
				reviewFocus,
				octokit,
				owner,
				repo,
				contextFiles
			);

			allComments.push(...comments);
		}

		const filteredComments = filterCommentsBySeverity(allComments, minSeverity);
		const reviewedFilesCount = filteredFiles.length;
		const totalIssueCount = filteredComments.length;
		core.info(
			`Filtered ${allComments.length} comments to ${filteredComments.length} based on minimum severity: ${minSeverity}`
		);

		if (filteredComments.length > 0) {
			const shouldBlock = blockOnIssues && filteredComments.length > 0;
			const reviewEvent = shouldBlock ? 'REQUEST_CHANGES' : 'COMMENT';

			const reviewOptions: ReviewOptions = {
				owner,
				repo,
				prNumber,
				headSha,
				reviewEvent,
			};

			await postCommentsToPR(octokit, filteredComments, headSha, reviewOptions);
		}

		if (reviewedFilesCount > 0) {
			const summaryBody = `# 🤖 AI Code Review

**Reviewed files:** ${reviewedFilesCount}
**Total issues found:** ${totalIssueCount}`;

			await octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: prNumber,
				body: summaryBody,
			});
			core.info('Posted review summary to PR');
		}

		// Update existing AI comments based on PR changes
		if (updateCommentsOnChange) {
			await updateCommentsOnPrChange(octokit, owner, repo, prNumber, headSha);
		}

		core.setOutput(
			'review-summary',
			`${reviewedFilesCount} files reviewed, ${totalIssueCount} issues found`
		);

		if (autoApproveWhenResolved) {
			const botLogin = await getAuthenticatedLogin(octokit);
			if (!botLogin) {
				core.info('Unable to determine authenticated user; skipping approval.');
				return;
			}

			const aiCommentsResolved = await areAiCommentsResolved(
				octokit,
				owner,
				repo,
				prNumber,
				botLogin
			);

			if (aiCommentsResolved) {
				await approvePullRequest(octokit, owner, repo, prNumber);
			} else {
				core.info('AI review comments are still unresolved; not approving.');
			}
		}
	} catch (error) {
		core.setFailed(`Action failed: ${error}`);
	}
}

function logConfig(): void {
	core.debug(`OpenAI base URL: ${core.getInput('openai-base-url')}`);
	core.debug(`OpenAI model: ${core.getInput('openai-model')}`);
	core.debug(`OpenAI API key: ${core.getInput('openai-api-key')}`);
	core.debug(`Review focus: ${core.getInput('review-prompt')}`);
	core.debug(`Max files: ${core.getInput('max-files')}`);
	core.debug(`Exclude patterns: ${core.getInput('exclude-patterns')}`);
	core.debug(`Include directories: ${core.getInput('include-dir')}`);
	core.debug(
		`Auto-approve when resolved: ${core.getBooleanInput('auto-approve-when-resolved')}`
	);
	core.debug(`Minimum severity: ${core.getInput('min-severity')}`);
	core.debug(`Block on issues: ${core.getBooleanInput('block-on-issues')}`);
	core.debug(
		`Include full content: ${core.getBooleanInput('include-full-content')}`
	);
	core.debug(`Max context chars: ${core.getInput('max-context-chars')}`);
}

// ============================================================================
// Entry Point
// ============================================================================

if (require.main === module) {
	run();
}

// ============================================================================
// Exports
// ============================================================================

export * from './prompts';
export { parseReviewForComments, parseReviewResponse } from './reviewParser';
export { processFile, filterFiles } from './fileProcessor';
export { postCommentsToPR } from './commentPoster';
export * from './approvalManager';
export type { FileData, ReviewOptions } from './types';
