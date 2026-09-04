import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveEngineConfig } from './adapter/engine-config.js';
import {
	type PrContentEngineOptions,
	type PrReviewEngineOptions,
	type SecurityEngineOptions,
	mapPrContentInputs,
	mapPrReviewInputs,
	mapSecurityInputs,
} from './adapter/legacy-inputs.js';
import { preparePiRuntimeConfig } from './adapter/runtime.js';
import { prioritizeFiles } from './context/files.js';
import { fetchPrContext } from './context/pr.js';
import { runPrelint } from './context/prelint.js';
import { isActorAllowed } from './github/actor-filter.js';
import { updatePrContent } from './github/pr-content.js';
import { trackPhase } from './github/progress.js';
import { buildJobSummary, publishReview } from './github/review.js';
import type { PublisherOctokit } from './github/review.js';
import {
	PiHarness,
	type PiRunLog,
	buildAgentDebugSection,
} from './harness/pi.js';
import { REVIEW_OPTION_DEFAULTS } from './llm/config.js';
import { OpenAiCompatibleProvider } from './llm/openai-compatible.js';
import {
	buildUserPrompt,
	createSystemPrompt,
} from './llm/prompts/pr-content.js';
import type { ChatCompletion, ChatMessage } from './llm/provider.js';
import { resolveReviewMode, validateReviewEvent } from './modes/detector.js';
import { resolveProfiles, rulesForProfiles } from './profiles/index.js';
import { runReview } from './review/reviewer.js';
import { runSecurityWorkflow } from './security/orchestrator.js';
import { publishSecurityReview } from './security/reporters/security-publisher.js';
import { CURATED_SECURITY_SKILLS } from './security/skills/registry.js';
import { renderSkillsForPrompt } from './security/skills/selector.js';
import type { SecurityContext } from './security/types.js';
import { profilesWithSkills } from './skills/registry.js';

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
			if (args.comments !== undefined && !Array.isArray(args.comments))
				throw new Error('comments must be array');
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
		listThreads: async (args: Record<string, unknown>) => {
			const anyOctokit = client as unknown as {
				paginate?: (
					route: string,
					params: Record<string, unknown>
				) => Promise<unknown[]>;
				rest?: { pulls?: unknown };
			};
			if (anyOctokit.paginate) {
				const threads = await anyOctokit.paginate(
					'GET /repos/{owner}/{repo}/pulls/{pull_number}/threads',
					{
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						pull_number: requiredNumber(args, 'pull_number'),
					}
				);
				return threads as Array<{
					resolved?: boolean;
					comments?: Array<{ user?: { login?: string } | null }>;
				}>;
			}
			return [];
		},
	};
	return {
		rest: {
			pulls,
			repos: {
				getCollaboratorPermissionLevel: (args: Record<string, unknown>) =>
					client.rest.repos.getCollaboratorPermissionLevel({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						username: requiredString(args, 'username'),
					}),
			},
			issues: {
				listComments: (args: Record<string, unknown>) =>
					client.rest.issues.listComments({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						issue_number: requiredNumber(args, 'issue_number'),
						page: requiredNumber(args, 'page'),
						per_page: requiredNumber(args, 'per_page'),
					}),
				updateComment: (args: Record<string, unknown>) =>
					client.rest.issues.updateComment({
						owner: requiredString(args, 'owner'),
						repo: requiredString(args, 'repo'),
						comment_id: requiredNumber(args, 'comment_id'),
						body: requiredString(args, 'body'),
					}),
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

let agentDebugWritten = false;
async function appendAgentDebugToSummary(
	runs: readonly PiRunLog[]
): Promise<void> {
	if (!core.isDebug() || agentDebugWritten) return;
	const section = buildAgentDebugSection(runs);
	if (!section) return;
	core.info(
		`[debug] agent runtime log: ${runs.length} run(s), ${section.length} chars`
	);
	try {
		core.summary.addRaw(`\n\n${section}\n`);
		await core.summary.write();
		agentDebugWritten = true;
	} catch (error) {
		core.warning(
			`[debug] failed to write agent log to summary: ${error instanceof Error ? error.message : String(error)}`
		);
	}
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

	if (result.conclusion.failThresholdReached) {
		core.setFailed(
			`Security review failed: found vulnerabilities reaching or exceeding fail threshold (${options.failOn}).`
		);
	}
}

export async function main(argv: string[]): Promise<void> {
	try {
		const mode = resolveReviewMode(core.getInput('mode') || undefined);
		const eventName = process.env.GITHUB_EVENT_NAME;
		const eventAction = (github.context.payload as { action?: string }).action;
		const validation = validateReviewEvent(eventName, eventAction);
		if (!validation.supported) {
			core.warning(
				`[review] Unsupported event ${eventName ?? 'unknown'}${eventAction ? `/${eventAction}` : ''}: ${validation.reason} — skipping review.`
			);
			return;
		}
		const options = parseArgs(argv);
		core.info(
			`[review] initialized (action: ${options.action}, mode: ${mode})`
		);
		const actorForFilter =
			process.env.GITHUB_ACTOR ??
			(
				github.context.payload.pull_request?.user as
					| { login?: string }
					| undefined
			)?.login ??
			(github.context.actor as string | undefined) ??
			'';
		const actorCheck = isActorAllowed(actorForFilter, {
			allowedBots: core.getInput('allowed-bots'),
			excludeActors: core.getInput('exclude-actors'),
		});
		if (!actorCheck.allowed) {
			core.info(`[review] Skipping review: ${actorCheck.reason}`);
			return;
		}
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

		if (mode === 'security') {
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
					core.getInput('security_profile') ||
					core.getInput('security-profile'),
				security_min_severity:
					core.getInput('security_min_severity') ||
					core.getInput('security-min-severity'),
				security_fail_on:
					core.getInput('security_fail_on') ||
					core.getInput('security-fail-on'),
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
		const trackEnabled = core.getInput('track-progress') === 'true';
		trackPhase('fetch', `PR #${prNumber}`, { enabled: trackEnabled });
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
		trackPhase(
			'filter',
			`${reviewContext.diff.files.length} files after filter`,
			{ enabled: trackEnabled }
		);
		if (reviewContext.diff.files.length === 0) {
			core.info('[review] No files to review after filtering');
			return;
		}

		const detected = resolveProfiles(
			reviewContext.repositoryPath,
			process.env.AI_REVIEW_PROFILE
		);
		// ponytail: default=all — trade ~9k system-prompt chars for full coverage; revert to `detected` to save cost.
		const profiles =
			process.env.AI_REVIEW_PROFILE == null
				? profilesWithSkills().map((id) => ({ id, evidence: ['default:all'] }))
				: detected;
		reviewContext.profiles = profiles;
		trackPhase('profiles', profiles.map((p) => p.id).join(', ') || 'auto', {
			enabled: trackEnabled,
		});
		const previousConfigDir = process.env.PI_CODING_AGENT_DIR;
		let harness: PiHarness | undefined;
		const runtimeConfig = await preparePiRuntimeConfig(llmConfig, {
			profiles: profiles.map((p) => p.id),
		});
		process.env.PI_CODING_AGENT_DIR = runtimeConfig.configDir;
		try {
			// Run deterministic static analyzers when opted in via env
			// var. Cannot add a new action input because the V1
			// contract (docs/v1-interface-contract.md) is frozen.
			const enablePrelint = process.env.AI_REVIEW_ENABLE_PRELINT === 'true';
			const prelintResult = enablePrelint
				? await runPrelint({
						repositoryPath: reviewContext.repositoryPath,
						changedFiles: reviewContext.diff.files,
					})
				: { findings: [], ran: [], skipped: [] };
			if (prelintResult.skipped.length > 0) {
				core.info(
					`[prelint] Skipped tools: ${prelintResult.skipped.join(', ')}`
				);
			}
			if (prelintResult.ran.length > 0) {
				core.info(
					`[prelint] Ran ${prelintResult.ran.join(', ')} — ${prelintResult.findings.length} findings`
				);
			}
			trackPhase('harness', 'Pi review start', { enabled: trackEnabled });
			const piBinaryRaw = core.getInput('pi-binary-path');
			let piBinaryPath: string | undefined;
			if (piBinaryRaw) {
				try {
					const { accessSync, constants } = await import('node:fs');
					accessSync(piBinaryRaw, constants.X_OK);
					piBinaryPath = piBinaryRaw;
				} catch {
					core.warning(
						`[review] pi-binary-path ${piBinaryRaw} not executable — falling back to pi`
					);
				}
			}
			// ponytail: all security skills into default review (8 domains, ~4k chars); filter by domain when cost matters.
			const allSecurityPrompt = renderSkillsForPrompt(CURATED_SECURITY_SKILLS);
			harness = new PiHarness({
				binaryPath: piBinaryPath,
				piArgs: core.getInput('pi-args'),
				timeoutMs: positiveTimeout(
					process.env.AI_REVIEW_PI_TIMEOUT_MS,
					15 * 60_000
				),
				model: llmConfig.model,
				apiKey: llmConfig.apiKey,
				includeFullContent: legacyOptions.includeFullContent,
				maxContextChars: legacyOptions.maxContextChars,
				extraRules: [allSecurityPrompt, rulesForProfiles(profiles)]
					.filter(Boolean)
					.join('\n\n'),
				provider: llmConfig.provider,
				toolFindings: prelintResult.findings,
			});
			const promptFile = await readPromptFileIfNeeded(
				reviewContext.repositoryPath
			);
			const result = await runReview(reviewContext, harness, {
				minConfidence: Number.parseFloat(
					process.env.AI_REVIEW_MIN_CONFIDENCE || '0.8'
				),
				extraRules: [
					promptFile,
					allSecurityPrompt,
					legacyOptions.reviewPrompt,
					rulesForProfiles(profiles),
				]
					.filter(Boolean)
					.join('\n\n'),
				minSeverity: legacyOptions.minSeverity,
			});
			// Surface tool findings + prelint diagnostics in the result
			// so they render in the GitHub review summary
			// (collapsible section, see docs/index.md).
			result.toolFindings = prelintResult.findings;
			result.diagnostics = {
				...result.diagnostics,
				toolFindingsTotal: prelintResult.findings.length,
				prelintRan: prelintResult.ran,
				prelintSkipped: prelintResult.skipped,
			};
			await appendAgentDebugToSummary(harness.runs);
			trackPhase(
				'harness',
				`Pi review done: ${result.findings.length} findings`,
				{ enabled: trackEnabled }
			);
			await publishReview(octokit, {
				owner: repoInfo.owner,
				repo: repoInfo.repo,
				prNumber,
				headSha: reviewContext.pullRequest.headSha,
				result,
				model: llmConfig.model,
				blockOnIssues: legacyOptions.blockOnIssues,
				minSeverity: legacyOptions.minSeverity,
				requireWritePermissions:
					core.getInput('require-write-permissions') === 'true',
				stickySummary: core.getInput('sticky-summary') !== 'false',
				bufferInlineComments:
					core.getInput('buffer-inline-comments') !== 'false' &&
					core.getInput('classify-inline-comments') !== 'false',
				autoApproveWhenResolved: legacyOptions.autoApproveWhenResolved,
				actor:
					process.env.GITHUB_ACTOR ??
					(
						github.context.payload.pull_request?.user as
							| { login?: string }
							| undefined
					)?.login ??
					(github.context.actor as string | undefined),
			});
			trackPhase('publish', 'review published', { enabled: trackEnabled });
			core.setOutput(
				'review-summary',
				`${result.filesReviewed.length} files reviewed, ${result.findings.length} issues found`
			);
		} finally {
			// Ensure agent debug log attached even if review/publish failed
			try {
				if (harness) await appendAgentDebugToSummary(harness.runs);
			} catch {}
			await runtimeConfig.cleanup();
			if (previousConfigDir === undefined)
				Reflect.deleteProperty(process.env, 'PI_CODING_AGENT_DIR');
			else process.env.PI_CODING_AGENT_DIR = previousConfigDir;
		}
	} catch (error) {
		core.setFailed(
			`Action failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function readPromptFileIfNeeded(
	repoPath: string
): Promise<string | undefined> {
	const file = core.getInput('review-prompt-file');
	if (!file) return undefined;
	if (file.includes('\0')) {
		core.warning(
			`[review] review-prompt-file ${file} contains null byte — ignored`
		);
		return undefined;
	}
	try {
		const { readFileSync, statSync } = await import('node:fs');
		const { isAbsolute, relative, resolve } = await import('node:path');
		// Repo-relative contract: must be inside the workspace root.
		if (isAbsolute(file)) {
			core.warning(
				`[review] review-prompt-file ${file} must be repo-relative — ignored`
			);
			return undefined;
		}
		const full = resolve(repoPath, file);
		if (full !== repoPath) {
			const rel = relative(repoPath, full);
			if (rel.startsWith('..') || isAbsolute(rel)) {
				core.warning(
					`[review] review-prompt-file ${file} escapes repository — ignored`
				);
				return undefined;
			}
		}
		const stat = statSync(full);
		if (stat.size > 50 * 1024) {
			core.warning(
				`[review] review-prompt-file ${file} exceeds 50 KiB — ignored`
			);
			return undefined;
		}
		const content = readFileSync(full, 'utf8');
		return content.trim() || undefined;
	} catch (error) {
		core.warning(
			`[review] review-prompt-file read failed: ${error instanceof Error ? error.message : String(error)}`
		);
		return undefined;
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
