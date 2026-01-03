import * as core from '@actions/core';
import * as github from '@actions/github';
import OpenAI from 'openai';
import type { OctokitType } from './types';
import type { CommentContext, ContextOptions } from './types';
import {
	shouldTriggerReply,
	createDefaultQuestionDetectionConfig,
} from './commentListener';
import {
	buildContextForReply,
	createDefaultContextOptions,
} from './contextBuilder';
import { generateReply, validateReply } from './replyGenerator';
import { postReplyWithFallback } from './replyPoster';

// ============================================================================
// Main Action
// ============================================================================

async function run(): Promise<void> {
	try {
		// Get inputs
		const githubToken = core.getInput('github-token', { required: true });
		const openaiApiKey = core.getInput('openai-api-key', { required: true });
		const openaiModel = core.getInput('openai-model') || 'gpt-4';
		const customPrompt = core.getInput('reply-prompt');
		const enableQuestionDetection =
			core.getBooleanInput('enable-question-detection');
		const includeFullContent =
			core.getBooleanInput('include-full-content');
		const maxContextChars = Number.parseInt(
			core.getInput('max-context-chars') || '10000'
		);

		logConfig();

		// Initialize clients
		const octokit = github.getOctokit(githubToken) as unknown as OctokitType;
		const openai = new OpenAI({
			apiKey: openaiApiKey,
			baseURL: core.getInput('openai-base-url'),
		});

		// Get comment from event payload
		const context = github.context;
		const payload = context.payload;

		// Check if this is an issue comment event on a PR
		if (!payload.comment || !payload.issue) {
			core.setFailed('Event payload missing comment or issue');
			return;
		}

		const issue = payload.issue;
		if (!issue.pull_request) {
			core.info('Comment is not on a pull request, skipping');
			return;
		}

		const comment = payload.comment;
		const commentId = comment.id;
		const commentBody = comment.body || '';
		const commentUser = comment.user?.login || '';
		const commentAuthorType = comment.user?.type;
		const commentCreatedAt = comment.created_at;

		const owner = context.repo.owner;
		const repo = context.repo.repo;
		const prNumber = issue.number;
		const prTitle = issue.title;

		// Get pull request details
		const { data: pullRequest } = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: prNumber,
		});

		const headSha = pullRequest.head?.sha || context.sha;

		core.info(
			`Processing comment #${commentId} on PR #${prNumber} by @${commentUser}`
		);

		// Check if we should trigger a reply
		const questionDetectionConfig =
			createDefaultQuestionDetectionConfig(enableQuestionDetection);
		if (!shouldTriggerReply(commentBody, commentAuthorType, questionDetectionConfig)) {
			core.info('Comment does not meet trigger criteria, skipping');
			return;
		}

		core.info('Comment meets trigger criteria, generating reply...');

		// Build context for the reply
		const contextOptions = createDefaultContextOptions(
			includeFullContent,
			maxContextChars
		);
		const replyContext = await buildContextForReply(
			octokit,
			commentId,
			prNumber,
			owner,
			repo,
			headSha,
			prTitle,
			commentBody,
			commentUser,
			commentCreatedAt,
			contextOptions
		);

		if (!replyContext) {
			core.info('Could not build reply context, skipping');
			return;
		}

		// Generate AI reply
		const replyBody = await generateReply(
			openai,
			replyContext,
			openaiModel,
			customPrompt
		);

		// Validate reply
		if (!validateReply(replyBody)) {
			core.setFailed('Generated reply validation failed');
			return;
		}

		// Post reply
		await postReplyWithFallback(octokit, {
			owner,
			repo,
			prNumber,
			parentCommentId: replyContext.parentComment.id,
		}, replyBody);

		core.setOutput('reply-generated', 'true');
		core.info('AI reply posted successfully');
	} catch (error) {
		core.setFailed(`Action failed: ${error}`);
	}
}

// ============================================================================
// Configuration Logging
// ============================================================================

function logConfig(): void {
	core.debug(`OpenAI base URL: ${core.getInput('openai-base-url')}`);
	core.debug(`OpenAI model: ${core.getInput('openai-model')}`);
	core.debug(`OpenAI API key: ${core.getInput('openai-api-key')}`);
	core.debug(`Reply prompt: ${core.getInput('reply-prompt')}`);
	core.debug(
		`Enable question detection: ${core.getBooleanInput('enable-question-detection')}`
	);
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

export * from './commentListener';
export * from './contextBuilder';
export * from './replyGenerator';
export * from './replyPoster';
export * from './prompts';
export * from './types';

