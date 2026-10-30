import * as core from '@actions/core';
import * as github from '@actions/github';
import {
	type SecurityEngineOptions,
	mapSecurityInputs,
} from '../adapter/legacy-inputs.js';
import { fetchPrContext } from '../context/pr.js';
import type { PublisherOctokit } from '../github/review.js';
import { securityFailureMessage } from '../security/completion.js';
import { runSecurityWorkflow } from '../security/orchestrator.js';
import { publishSecurityReview } from '../security/reporters/security-publisher.js';
import type { SecurityContext } from '../security/types.js';
import { toPublisherOctokit } from './octokit.js';

async function runSecurity(
	options: SecurityEngineOptions,
	octokit: PublisherOctokit,
	repoInfo: { owner: string; repo: string },
	prNumber?: number
): Promise<void> {
	let changedFiles: Array<{
		filename: string;
		status: string;
		additions: number;
		deletions: number;
		patch?: string;
	}> = [];
	let headSha =
		github.context.payload.pull_request?.head?.sha || github.context.sha;

	if (prNumber) {
		const prContext = await fetchPrContext(octokit, repoInfo, prNumber);
		changedFiles = prContext.diff.files.map((f) => ({
			filename: f.filename,
			status: f.status,
			additions: f.additions,
			deletions: f.deletions,
			patch: f.patch,
		}));
		headSha = prContext.pullRequest.headSha;
	}

	const securityContext: SecurityContext = {
		repositoryPath: process.env.GITHUB_WORKSPACE || process.cwd(),
		owner: repoInfo.owner,
		repo: repoInfo.repo,
		prNumber,
		baseSha: github.context.payload.pull_request?.base?.sha,
		headSha,
		changedFiles,
		options,
	};

	const result = await runSecurityWorkflow(securityContext, options);

	if (prNumber && (options.inlineComments || options.stickyComment)) {
		await publishSecurityReview(octokit, {
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			prNumber,
			headSha,
			result,
			inlineComments: options.inlineComments,
			stickyComment: options.stickyComment,
		});
	}

	core.info(result.summaryMarkdown);
	await core.summary.addRaw(result.summaryMarkdown).write();

	core.setOutput('security_findings', JSON.stringify(result.findings));
	core.setOutput('security_findings_count', String(result.findings.length));
	core.setOutput('security_risk', result.conclusion.risk);
	if (result.sarifPath) core.setOutput('security_sarif_path', result.sarifPath);
	if (result.reportPath)
		core.setOutput('security_report_path', result.reportPath);
	core.setOutput('security_conclusion', JSON.stringify(result.conclusion));
	core.setOutput(
		'review-summary',
		`${result.findings.length} security finding(s) validated (Risk: ${result.conclusion.risk})`
	);

	const failureMessage = securityFailureMessage(
		result.conclusion,
		options.failOn
	);
	if (failureMessage) core.setFailed(failureMessage);
}

/** Reads the security-mode action inputs and runs the security flow. */
export async function runSecurityAction(): Promise<void> {
	const githubToken =
		core.getInput('github-token') ||
		core.getInput('github_token') ||
		process.env.GITHUB_TOKEN ||
		'';
	const octokit = toPublisherOctokit(github.getOctokit(githubToken));
	const repoInfo = {
		owner: github.context.repo?.owner || '',
		repo: github.context.repo?.repo || '',
	};
	const prNumber = github.context.payload.pull_request?.number;
	const secOptions = mapSecurityInputs({
		'github-token': githubToken,
		'openai-api-key':
			core.getInput('openai-api-key') || core.getInput('api_key'),
		'openai-base-url':
			core.getInput('openai-base-url') || core.getInput('base_url'),
		'openai-model': core.getInput('openai-model') || core.getInput('model'),
		mode: 'security',
		security_profile:
			core.getInput('security_profile') || core.getInput('security-profile'),
		security_min_severity:
			core.getInput('security_min_severity') ||
			core.getInput('security-min-severity'),
		security_fail_on:
			core.getInput('security_fail_on') || core.getInput('security-fail-on'),
		security_confirm_findings:
			core.getInput('security_confirm_findings') ||
			core.getInput('security-confirm-findings'),
		security_inline_comments:
			core.getInput('security_inline_comments') ||
			core.getInput('security-inline-comments'),
		security_sticky_comment:
			core.getInput('security_sticky_comment') ||
			core.getInput('security-sticky-comment'),
		security_sarif:
			core.getInput('security_sarif') || core.getInput('security-sarif'),
		security_max_findings:
			core.getInput('security_max_findings') ||
			core.getInput('security-max-findings'),
		security_risk_threshold:
			core.getInput('security_risk_threshold') ||
			core.getInput('security-risk-threshold'),
		'pi-args': core.getInput('pi-args'),
		'pi-binary-path': core.getInput('pi-binary-path'),
		'track-progress': core.getInput('track-progress'),
	});
	await runSecurity(secOptions, octokit, repoInfo, prNumber);
}
