import { performance } from 'node:perf_hooks';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { resolveEngineConfig } from '../adapter/engine-config.js';
import {
	DEFAULT_EXCLUDE_PATTERNS,
	type PrReviewEngineOptions,
	mapPrReviewInputs,
} from '../adapter/legacy-inputs.js';
import { preparePiRuntimeConfig } from '../adapter/runtime.js';
import { prioritizeFiles } from '../context/files.js';
import { fetchPrContext } from '../context/pr.js';
import { runPrelint } from '../context/prelint.js';
import { loadScorecardContext } from '../context/scorecard.js';
import { trackPhase } from '../github/progress.js';
import {
	buildJobSummary,
	publishReview,
	publishSkipCheckRun,
} from '../github/review.js';
import {
	DEFAULT_MAX_ASSISTANT_BYTES,
	DEFAULT_MAX_OUTPUT_BYTES,
	DEFAULT_MAX_TOOL_CALLS,
	PiHarness,
	type PiRunLog,
	buildAgentDebugSection,
} from '../harness/pi.js';
import { REVIEW_OPTION_DEFAULTS } from '../llm/config.js';
import { OpenAiCompatibleProvider } from '../llm/openai-compatible.js';
import { shouldSkipDraft } from '../modes/detector.js';
import { resolveProfiles, rulesForProfiles } from '../profiles/index.js';
import { buildFileCoverage } from '../review/coverage.js';
import {
	buildRawHarnessSection,
	incompleteReviewFailure,
	rawHarnessDumpEnabled,
	reviewSummaryText,
} from '../review/execution.js';
import { loadRepositoryInstructions } from '../review/instructions.js';
import type { BaseFileData } from '../review/prompt-file.js';
import { loadReviewPromptFile } from '../review/prompt-file.js';
import {
	buildReviewReport,
	serializeReviewReport,
	withReviewReportOutput,
} from '../review/report.js';
import { runReview } from '../review/reviewer.js';
import {
	mergeSecretFindings,
	scanReviewSecrets,
} from '../review/secret-prepass.js';
import { applyVerifyPass, sanitiseVerifyReason } from '../review/verify.js';
import { classifyPrRisk } from '../security/classifier/risk-classifier.js';
import { selectReviewSecuritySkills } from '../security/skills/auto-select.js';
import {
	parseBoundedFloat,
	parseEnum,
	parsePositiveInt,
} from '../shared/numeric.js';
import { profilesWithSkills } from '../skills/registry.js';
import type { ReviewResult, Severity } from '../types/finding.js';
import { toPublisherOctokit } from './octokit.js';

/**
 * Report a completed, neutral check for a run that reviewed nothing, so a
 * required check is never left unreported. Best effort: a Checks API error
 * only logs a warning.
 */
async function reportSkippedCheck(
	enabled: boolean,
	octokit: Parameters<typeof publishSkipCheckRun>[0],
	repo: { owner: string; repo: string },
	headSha: string,
	reason: string
): Promise<void> {
	if (!enabled) return;
	await publishSkipCheckRun(octokit, {
		owner: repo.owner,
		repo: repo.repo,
		headSha,
		reason,
	});
}

function positiveTimeout(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Like {@link positiveTimeout} but explicit `0` is honored (it disables the
 * corresponding cap), so an operator can opt out of a budget instead of
 * silently getting the default.
 */
function budgetOrFallback(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === '') return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

/** Runs the pull-request review flow (the default `review` mode). */
export async function runPrReviewAction(): Promise<void> {
	const context = github.context;
	if (!context.payload.pull_request) {
		core.setFailed('This action only runs on pull requests');
		return;
	}

	const rawMaxFiles = core.getInput('max-files');
	const legacyOptions: PrReviewEngineOptions = mapPrReviewInputs({
		'github-token': core.getInput('github-token'),
		'openai-api-key': core.getInput('openai-api-key'),
		'openai-base-url': core.getInput('openai-base-url'),
		'openai-model': core.getInput('openai-model'),
		'review-prompt': core.getInput('review-prompt'),
		'max-files': rawMaxFiles,
		'review-effort': core.getInput('review-effort'),
		'exclude-patterns': core.getInput('exclude-patterns'),
		'include-dir': core.getInput('include-dir'),
		'auto-approve-when-resolved': core.getInput('auto-approve-when-resolved'),
		'min-severity': core.getInput('min-severity'),
		'block-on-issues': core.getInput('block-on-issues'),
		'include-full-content': core.getInput('include-full-content'),
		'max-context-chars': core.getInput('max-context-chars'),
		'scorecard-context': core.getInput('scorecard-context'),
		'repository-instructions': core.getInput('repository-instructions'),
		'check-run': core.getInput('check-run'),
		'secret-scan': core.getInput('secret-scan'),
		'fix-prompts': core.getInput('fix-prompts'),
		'security-skills': core.getInput('security-skills'),
	});
	const llmConfig = resolveEngineConfig(legacyOptions);
	const octokit = toPublisherOctokit(
		github.getOctokit(legacyOptions.githubToken)
	);
	const prNumber = context.payload.pull_request.number;
	const repoInfo = { owner: context.repo.owner, repo: context.repo.repo };
	const trackEnabled = core.getInput('track-progress') === 'true';
	const reviewStarted = performance.now();
	trackPhase('fetch', `PR #${prNumber}`, { enabled: trackEnabled });
	const reviewContext = await fetchPrContext(octokit, repoInfo, prNumber);
	if (shouldSkipDraft(reviewContext.pullRequest.draft)) {
		core.info(
			`[review] PR #${prNumber} is a draft and AI_REVIEW_SKIP_DRAFTS=true — skipping review`
		);
		core.setOutput('review-summary', 'skipped: draft pull request');
		await reportSkippedCheck(
			legacyOptions.checkRun,
			octokit,
			repoInfo,
			reviewContext.pullRequest.headSha,
			'the pull request is a draft'
		);
		return;
	}
	reviewContext.repositoryPath = process.env.GITHUB_WORKSPACE || process.cwd();
	const allPrFiles = reviewContext.diff.files;
	const filtered = applyLegacyFilters(
		allPrFiles.map((f) => f.filename),
		legacyOptions
	);
	const envLimits = readReviewEnvLimits(process.env);
	const maxFiles = Math.min(legacyOptions.maxFiles, envLimits.maxFiles);
	// Captured before filtering so the summary can report
	// "N of M (X excluded by filter)" (src/github/comments.ts).
	const filesTotal = allPrFiles.length;
	const candidates = allPrFiles.filter(
		(f) => filtered.includes(f.filename) && Boolean(f.patch)
	);
	const prelintRequested = process.env.AI_REVIEW_ENABLE_PRELINT === 'true';
	const verifySetting = process.env.AI_REVIEW_VERIFY_PASS;
	const requestedEffort = legacyOptions.reviewEffort;
	const nonPositiveCap = [rawMaxFiles, process.env.AI_REVIEW_MAX_FILES].some(
		(value) => value?.trim() && Number(value) <= 0
	);
	let reviewEffort = requestedEffort === 'auto' ? 'balanced' : requestedEffort;
	if (nonPositiveCap) {
		reviewEffort = 'balanced';
	} else if (
		requestedEffort === 'auto' &&
		filtered.length <= 3 &&
		filtered.length <= maxFiles &&
		!reviewContext.diff.filesTruncated &&
		!legacyOptions.scorecardContext &&
		legacyOptions.securitySkills !== 'auto' &&
		!prelintRequested &&
		verifySetting !== 'true' &&
		classifyPrRisk(allPrFiles.filter((f) => filtered.includes(f.filename)))
			.domains.length === 0
	) {
		reviewEffort = 'lite';
	}
	const skipOptional = reviewEffort === 'lite';
	const securitySkills = skipOptional ? 'all' : legacyOptions.securitySkills;
	const enableVerify = !skipOptional && verifySetting === 'true';
	reviewContext.diff.files = prioritizeFiles(
		candidates,
		reviewEffort === 'deep'
			? envLimits.maxFiles
			: skipOptional
				? Math.min(3, maxFiles)
				: maxFiles
	);
	const filesSelected = reviewContext.diff.files.length;
	// Publication settings shared by the model review and the secret-only path.
	const publishBase = {
		owner: repoInfo.owner,
		repo: repoInfo.repo,
		prNumber,
		headSha: reviewContext.pullRequest.headSha,
		model: llmConfig.model,
		filesTotal,
		blockOnIssues: legacyOptions.blockOnIssues,
		minSeverity: legacyOptions.minSeverity,
		requireWritePermissions:
			core.getInput('require-write-permissions') === 'true',
		stickySummary: core.getInput('sticky-summary') !== 'false',
		bufferInlineComments:
			core.getInput('buffer-inline-comments') !== 'false' &&
			core.getInput('classify-inline-comments') !== 'false',
		autoApproveWhenResolved: legacyOptions.autoApproveWhenResolved,
		checkRun: legacyOptions.checkRun,
		fixPrompts: legacyOptions.fixPrompts,
		actor:
			process.env.GITHUB_ACTOR ??
			(
				github.context.payload.pull_request?.user as
					| { login?: string }
					| undefined
			)?.login ??
			(github.context.actor as string | undefined),
	};
	trackPhase(
		'filter',
		`${reviewContext.diff.files.length} files after filter`,
		{ enabled: trackEnabled }
	);
	if (reviewContext.diff.files.length === 0) {
		const emptyMessage = `[review] No files to review after filtering (${filesTotal} changed, include-dir=${legacyOptions.includeDirs?.join(',') ?? '(none)'}, exclude-patterns=${legacyOptions.excludePatterns.join(',')})`;
		if (
			classifyEmptySelection({
				filesTotal,
				filteredCount: filtered.length,
				includeDirs: legacyOptions.includeDirs,
				excludePatterns: legacyOptions.excludePatterns,
			}) === 'warning'
		)
			core.warning(emptyMessage);
		else core.notice(emptyMessage);
		// The secret scan is independent of the file filters, so a docs-only or
		// fully excluded pull request is still scanned and blocked on a match.
		// The result is published even when nothing matched, so an earlier
		// secret-only block is withdrawn once the credential is gone.
		if (legacyOptions.secretScan) {
			const secrets = scanReviewSecrets(allPrFiles);
			const result: ReviewResult = {
				findings: [],
				summary:
					'No files were selected for the model review; only the deterministic secret scan ran.',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: [],
				diagnostics: { reviewEffort },
				reviewStatus: 'complete',
			};
			mergeSecretFindings(result, secrets);
			const filesExcluded = Math.max(filesTotal - 0, 0);
			await withReviewReportOutput(
				async () => {
					await publishReview(octokit, {
						...publishBase,
						result,
						filesExcluded,
						filesSelected: 0,
						// Nothing was reviewed by the model, so no file was.
						filesUnreviewed: filtered.length,
					});
					trackPhase('publish', 'secret scan published', {
						enabled: trackEnabled,
					});
				},
				() =>
					serializeReviewReport(
						buildReviewReport({
							result,
							filesTotal,
							filesExcluded,
							fileCoverage: buildFileCoverage({
								files: allPrFiles,
								filteredPaths: filtered,
								selectedPaths: [],
								reviewedPaths: [],
								failedGroups: 0,
							}),
						})
					),
				(serialized) => core.setOutput('review-report', serialized)
			);
			await core.summary
				.addRaw(
					buildJobSummary({
						model: llmConfig.model,
						durationMs: performance.now() - reviewStarted,
						filesReviewed: [],
						filesTotal,
						filesExcluded,
						filesSelected: 0,
						result,
						toolFindings: [],
						diagnostics: result.diagnostics,
					})
				)
				.write();
			core.setOutput(
				'review-summary',
				`secret scan only: ${result.findings.length} credential finding(s); no files were selected for review`
			);
			return;
		}
		core.setOutput('review-summary', 'skipped: no files to review');
		await reportSkippedCheck(
			legacyOptions.checkRun,
			octokit,
			repoInfo,
			reviewContext.pullRequest.headSha,
			'no files were selected for review'
		);
		return;
	}

	const detected = resolveProfiles(
		reviewContext.repositoryPath,
		process.env.AI_REVIEW_PROFILE
	);
	// Detected profiles by default: loading every stack's rules for a repo
	// that uses one stack buries the relevant rules in ~6k chars of noise and
	// measurably degrades review quality. `AI_REVIEW_PROFILE=all` keeps the
	// old load-everything behavior; an explicit comma list still pins stacks.
	const loadAllProfiles = process.env.AI_REVIEW_PROFILE === 'all';
	const profiles = loadAllProfiles
		? profilesWithSkills().map((id) => ({
				id,
				evidence: ['AI_REVIEW_PROFILE=all'],
			}))
		: detected;
	reviewContext.profiles = profiles;
	trackPhase(
		'profiles',
		profiles.length > 0
			? profiles.map((p) => p.id).join(', ')
			: 'none detected',
		{ enabled: trackEnabled }
	);
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
		const enablePrelint = !skipOptional && prelintRequested;
		const prelintResult = enablePrelint
			? await runPrelint({
					repositoryPath: reviewContext.repositoryPath,
					changedFiles: reviewContext.diff.files,
				})
			: { findings: [], ran: [], skipped: [] };
		if (prelintResult.skipped.length > 0) {
			core.info(`[prelint] Skipped tools: ${prelintResult.skipped.join(', ')}`);
		}
		if (prelintResult.ran.length > 0) {
			core.info(
				`[prelint] Ran ${prelintResult.ran.join(', ')} — ${prelintResult.findings.length} findings`
			);
		}
		const scorecardContext = await loadScorecardContext({
			enabled: !skipOptional && legacyOptions.scorecardContext,
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			isPrivate: context.payload.repository?.private,
			log: core.info,
		});
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
		// Default `all` keeps every skill; opt-in `auto` filters by classified domain.
		const skillSelection = selectReviewSecuritySkills(
			securitySkills,
			reviewContext.diff.files,
			reviewContext.diff.filesTruncated
		);
		if (securitySkills === 'auto') {
			core.info(
				`[security-skills] auto: ${skillSelection.fellBackToAll ? 'could not classify, using all skills' : `${skillSelection.domains.join(', ') || 'validation gate only'} (saved ${skillSelection.savedChars} chars)`}`
			);
		}
		const allSecurityPrompt = skillSelection.prompt;
		const fetchBaseContent = async (path: string, ref: string) => {
			try {
				const res = await github
					.getOctokit(legacyOptions.githubToken)
					.rest.repos.getContent({ ...repoInfo, path, ref });
				return res.data as BaseFileData | BaseFileData[];
			} catch (error) {
				if ((error as { status?: number }).status === 404) return undefined;
				throw error;
			}
		};
		const promptFile = await loadReviewPromptFile({
			repoPath: reviewContext.repositoryPath,
			file: core.getInput('review-prompt-file'),
			baseSha: reviewContext.pullRequest.baseSha,
			filesTruncated: reviewContext.diff.filesTruncated,
			fetchBase: fetchBaseContent,
			changedPaths: new Set(
				allPrFiles.flatMap((f) =>
					f.previousFilename ? [f.filename, f.previousFilename] : [f.filename]
				)
			),
		});
		const instructions = legacyOptions.repositoryInstructions
			? await loadRepositoryInstructions({
					repoPath: reviewContext.repositoryPath,
					baseSha: reviewContext.pullRequest.baseSha,
					changedPaths: allPrFiles.map((f) => f.filename),
					fetchBase: fetchBaseContent,
				})
			: { text: '', files: [] };
		const reviewRules = [
			promptFile,
			instructions.text,
			allSecurityPrompt,
			legacyOptions.reviewPrompt,
			rulesForProfiles(profiles),
		]
			.filter(Boolean)
			.join('\n\n');
		harness = new PiHarness({
			binaryPath: piBinaryPath,
			piArgs: core.getInput('pi-args'),
			timeoutMs: positiveTimeout(
				process.env.AI_REVIEW_PI_TIMEOUT_MS,
				15 * 60_000
			),
			maxOutputBytes: budgetOrFallback(
				process.env.AI_REVIEW_PI_MAX_OUTPUT_BYTES,
				DEFAULT_MAX_OUTPUT_BYTES
			),
			maxToolCalls: budgetOrFallback(
				process.env.AI_REVIEW_PI_MAX_TOOL_CALLS,
				DEFAULT_MAX_TOOL_CALLS
			),
			maxAssistantBytes: budgetOrFallback(
				process.env.AI_REVIEW_PI_MAX_ASSISTANT_BYTES,
				DEFAULT_MAX_ASSISTANT_BYTES
			),
			repairAttempts: budgetOrFallback(
				process.env.AI_REVIEW_PI_REPAIR_ATTEMPTS,
				1
			),
			model: llmConfig.model,
			apiKey: llmConfig.apiKey,
			includeFullContent: legacyOptions.includeFullContent,
			maxContextChars: legacyOptions.maxContextChars,
			extraRules: reviewRules,
			provider: llmConfig.provider,
			toolFindings: prelintResult.findings,
			scorecardContext,
		});
		const result = await runReview(reviewContext, harness, {
			minConfidence: envLimits.minConfidence,
			extraRules: reviewRules,
			minSeverity: legacyOptions.minSeverity,
		});
		if (instructions.files.length > 0)
			result.diagnostics = {
				...result.diagnostics,
				repositoryInstructions: instructions.files,
			};
		const failOnIncomplete =
			process.env.AI_REVIEW_FAIL_ON_INCOMPLETE !== 'false';
		// Opt-in second LLM pass (env-only; V1 contract frozen, no new
		// input): challenges high/critical findings, drops hallucinations.
		if (enableVerify) {
			try {
				const verifyProvider = new OpenAiCompatibleProvider(llmConfig);
				await applyVerifyPass(result, {
					toolFindings: prelintResult.findings,
					title: reviewContext.pullRequest.title,
					body: reviewContext.pullRequest.body,
					changedFiles: reviewContext.diff.files,
					maxContextChars: legacyOptions.maxContextChars,
					baseSha: reviewContext.pullRequest.baseSha,
					headSha: reviewContext.pullRequest.headSha,
					verify: async (prompt: string, maxOutputTokens: number) =>
						(
							await verifyProvider.complete(
								[{ role: 'user', content: prompt }],
								{ temperature: 0, maxOutputTokens }
							)
						).content,
					budgetUsd: envLimits.verifyBudgetUsd,
					minSeverity: envLimits.verifyMinSeverity,
				});
				trackPhase(
					'harness',
					`Verify pass done: ${result.findings.length} findings`,
					{ enabled: trackEnabled }
				);
			} catch (error) {
				core.warning(
					`[review] ${sanitiseVerifyReason(`verify pass failed, keeping main-pass findings: ${error instanceof Error ? error.message : String(error)}`)}`
				);
				result.reviewStatus = 'incomplete';
				result.diagnostics = {
					...result.diagnostics,
					verifyStatus: 'error',
					verifySkippedReason: sanitiseVerifyReason(
						`verify pass failed: ${error instanceof Error ? error.message : String(error)}`
					),
				};
			}
		}
		// Deterministic secret matches join after the verify pass, which only
		// challenges model output; they need no second opinion.
		if (legacyOptions.secretScan)
			mergeSecretFindings(result, scanReviewSecrets(allPrFiles));
		// Surface tool findings + prelint diagnostics in the result
		// so they render in the GitHub review summary
		// (collapsible section, see docs/index.md).
		result.toolFindings = prelintResult.findings;
		result.diagnostics = {
			...result.diagnostics,
			reviewEffort,
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
		// Post-filter count, not filesReviewed: the latter shrinks when a
		// harness group fails, which would misreport an outage as a filter
		// exclusion. Shared by the PR comment and the job summary below.
		const filesExcluded = Math.max(filesTotal - filesSelected, 0);
		// Report emission is attempted even when publishing fails: the
		// JSON describes the analysis result, which exists either way.
		// `buildReport` runs after publishReview settles, so a `stale`
		// status set while publishing is included. Redaction runs on a
		// serialized copy; the engine result is not mutated. Emission is
		// best effort: if building or writing the report also fails, the
		// publish error stays primary. See docs/v1-interface-contract.md.
		// The step's own judgement of incompleteness, computed after the verify
		// pass has run, so an opt-in check run reports the same outcome as the
		// step.
		const incompleteFailure = incompleteReviewFailure({
			result,
			filesSelected,
		});
		await withReviewReportOutput(
			async () => {
				await publishReview(octokit, {
					...publishBase,
					result,
					filesExcluded,
					filesSelected,
					// Kept by the configured filters but never reviewed: max-files
					// cap, no patch, or a default-ignored path. Blocks auto-approval;
					// list such paths in exclude-patterns to accept them explicitly.
					filesUnreviewed: Math.max(filtered.length - filesSelected, 0),
					incomplete: Boolean(incompleteFailure),
					failOnIncomplete,
				});
				trackPhase('publish', 'review published', { enabled: trackEnabled });
			},
			() =>
				serializeReviewReport(
					buildReviewReport({
						result,
						filesTotal,
						filesExcluded,
						fileCoverage: buildFileCoverage({
							files: allPrFiles,
							filteredPaths: filtered,
							selectedPaths: reviewContext.diff.files.map(
								(file) => file.filename
							),
							reviewedPaths: result.filesReviewed,
							failedGroups: result.diagnostics?.failedGroups ?? 0,
						}),
					})
				),
			(serialized) => core.setOutput('review-report', serialized)
		);
		await core.summary
			.addRaw(
				buildJobSummary({
					model: llmConfig.model,
					durationMs: performance.now() - reviewStarted,
					filesReviewed: result.filesReviewed,
					filesTotal,
					filesExcluded,
					filesSelected,
					result,
					toolFindings: result.toolFindings,
					diagnostics: result.diagnostics,
				})
			)
			.write();
		// Opt-in raw harness dump: the only way to see what the model
		// actually returned when a group fails.
		const dumpBudget = rawHarnessDumpEnabled();
		if (dumpBudget && harness) {
			const section = buildRawHarnessSection(harness.runs, dumpBudget);
			if (section) await core.summary.addRaw(section).write();
		}
		const failure = incompleteFailure;
		core.setOutput(
			'review-summary',
			reviewSummaryText({ result, filesSelected }, failure)
		);
		// A crashed group or an unanalyzed file used to leave the step green
		// while the summary looked like a clean review. Fail the step so the
		// run is visible; set AI_REVIEW_FAIL_ON_INCOMPLETE=false to keep the
		// old lenient behavior.
		if (failure && process.env.AI_REVIEW_FAIL_ON_INCOMPLETE !== 'false') {
			core.setFailed(failure);
		} else if (failure) {
			core.warning(failure);
		}
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
}

export function normalizeIncludeDir(dir: string): string {
	return dir
		.trim()
		.replace(/\\/g, '/')
		.replace(/^(\.\/)+/, '')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

/**
 * Numeric env ceilings read by `main()`. Invalid values warn and fall back,
 * so a typo can never switch a safety limit off.
 */
export function readReviewEnvLimits(env: NodeJS.ProcessEnv): {
	maxFiles: number;
	minConfidence: number;
	verifyBudgetUsd: number;
	verifyMinSeverity: Severity;
} {
	return {
		maxFiles: parsePositiveInt(
			env.AI_REVIEW_MAX_FILES,
			REVIEW_OPTION_DEFAULTS.aiReviewMaxFiles,
			{ name: 'AI_REVIEW_MAX_FILES' }
		),
		minConfidence: parseBoundedFloat(env.AI_REVIEW_MIN_CONFIDENCE, 0.8, {
			name: 'AI_REVIEW_MIN_CONFIDENCE',
			min: 0,
			max: 1,
		}),
		verifyBudgetUsd: parseBoundedFloat(env.AI_REVIEW_VERIFY_BUDGET_USD, 0.5, {
			name: 'AI_REVIEW_VERIFY_BUDGET_USD',
			min: 0,
		}),
		verifyMinSeverity: parseEnum(
			env.AI_REVIEW_VERIFY_MIN_SEVERITY,
			['critical', 'high', 'medium', 'low'] as const,
			'high',
			'AI_REVIEW_VERIFY_MIN_SEVERITY'
		),
	};
}

/**
 * An empty selection is only worth a warning when a filter the user set
 * (include-dir, or exclude patterns other than the default) removed every
 * changed file. Lockfile-only, docs-only, and patch-less PRs are legitimate.
 */
export function classifyEmptySelection(args: {
	filesTotal: number;
	filteredCount: number;
	includeDirs?: string[];
	excludePatterns: string[];
}): 'notice' | 'warning' {
	if (args.filesTotal === 0 || args.filteredCount > 0) return 'notice';
	const effectiveDirs = (args.includeDirs ?? [])
		.map(normalizeIncludeDir)
		.filter((dir) => dir !== '' && dir !== '.');
	if (effectiveDirs.length > 0) return 'warning';
	const sorted = (list: string[]) => [...list].sort().join(',');
	const isDefault =
		sorted(args.excludePatterns) === sorted(DEFAULT_EXCLUDE_PATTERNS);
	return isDefault ? 'notice' : 'warning';
}

export function applyLegacyFilters(
	filenames: string[],
	options: { excludePatterns: string[]; includeDirs?: string[] }
): string[] {
	const excludeRegexes = options.excludePatterns.map(
		(pattern) =>
			new RegExp(
				`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
			)
	);
	const requestedDirs = options.includeDirs
		?.map(normalizeIncludeDir)
		.filter((dir) => dir !== '' && dir !== '.');
	// A `..` segment can never match a repository path: keep the include
	// filter active (matching nothing) rather than widening it to every file.
	const includeDirs = requestedDirs?.filter((dir) => {
		if (!dir.split('/').includes('..')) return true;
		core.warning(
			`[review] include-dir "${dir}" contains ".." and is ignored (matches no files)`
		);
		return false;
	});
	for (const dir of includeDirs ?? []) {
		if (!filenames.some((f) => f === dir || f.startsWith(`${dir}/`))) {
			core.warning(`[review] include-dir "${dir}" matches no changed files`);
		}
	}
	return filenames.filter((filename) => {
		if (excludeRegexes.some((regex) => regex.test(filename))) return false;
		if (requestedDirs?.length)
			return (includeDirs ?? []).some(
				(dir) => filename.startsWith(`${dir}/`) || filename === dir
			);
		return true;
	});
}
