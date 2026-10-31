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
import { buildJobSummary, publishReview } from '../github/review.js';
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
} from '../review/execution.js';
import type { BaseFileData } from '../review/prompt-file.js';
import { loadReviewPromptFile } from '../review/prompt-file.js';
import {
	buildReviewReport,
	serializeReviewReport,
	withReviewReportOutput,
} from '../review/report.js';
import { runReview } from '../review/reviewer.js';
import { applyVerifyPass } from '../review/verify.js';
import { CURATED_SECURITY_SKILLS } from '../security/skills/registry.js';
import { renderSkillsForPrompt } from '../security/skills/selector.js';
import { parseBoundedFloat, parsePositiveInt } from '../shared/numeric.js';
import { profilesWithSkills } from '../skills/registry.js';
import { toPublisherOctokit } from './octokit.js';

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
		'scorecard-context': core.getInput('scorecard-context'),
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
	reviewContext.diff.files = prioritizeFiles(
		allPrFiles.filter((f) => filtered.includes(f.filename) && Boolean(f.patch)),
		maxFiles
	);
	const filesSelected = reviewContext.diff.files.length;
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
		core.setOutput('review-summary', 'skipped: no files to review');
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
		const enablePrelint = process.env.AI_REVIEW_ENABLE_PRELINT === 'true';
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
			enabled: legacyOptions.scorecardContext,
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
		// ponytail: all security skills into default review (12 domains + validation gate); filter by domain when cost matters.
		const allSecurityPrompt = renderSkillsForPrompt(CURATED_SECURITY_SKILLS);
		const promptFile = await loadReviewPromptFile({
			repoPath: reviewContext.repositoryPath,
			file: core.getInput('review-prompt-file'),
			baseSha: reviewContext.pullRequest.baseSha,
			filesTruncated: reviewContext.diff.filesTruncated,
			fetchBase: async (path, ref) => {
				try {
					const res = await github
						.getOctokit(legacyOptions.githubToken)
						.rest.repos.getContent({ ...repoInfo, path, ref });
					return res.data as BaseFileData | BaseFileData[];
				} catch (error) {
					if ((error as { status?: number }).status === 404) return undefined;
					throw error;
				}
			},
			changedPaths: new Set(
				allPrFiles.flatMap((f) =>
					f.previousFilename ? [f.filename, f.previousFilename] : [f.filename]
				)
			),
		});
		const reviewRules = [
			promptFile,
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
		// Opt-in second LLM pass (env-only; V1 contract frozen, no new
		// input): challenges high/critical findings, drops hallucinations.
		if (process.env.AI_REVIEW_VERIFY_PASS === 'true') {
			try {
				const verifyProvider = new OpenAiCompatibleProvider(llmConfig);
				await applyVerifyPass(result, {
					toolFindings: prelintResult.findings,
					title: reviewContext.pullRequest.title,
					body: reviewContext.pullRequest.body,
					verify: async (prompt: string) =>
						(
							await verifyProvider.complete(
								[{ role: 'user', content: prompt }],
								{ temperature: 0, maxOutputTokens: 2048 }
							)
						).content,
					budgetUsd: envLimits.verifyBudgetUsd,
				});
				trackPhase(
					'harness',
					`Verify pass done: ${result.findings.length} findings`,
					{ enabled: trackEnabled }
				);
			} catch (error) {
				core.warning(
					`[review] verify pass failed, keeping main-pass findings: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
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
		await withReviewReportOutput(
			async () => {
				await publishReview(octokit, {
					owner: repoInfo.owner,
					repo: repoInfo.repo,
					prNumber,
					headSha: reviewContext.pullRequest.headSha,
					result,
					model: llmConfig.model,
					filesTotal,
					filesExcluded,
					filesSelected,
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
		core.setOutput(
			'review-summary',
			`${result.filesReviewed.length} files reviewed, ${result.findings.length} issues found`
		);
		// A crashed group or an unanalyzed file used to leave the step green
		// while the summary looked like a clean review. Fail the step so the
		// run is visible; set AI_REVIEW_FAIL_ON_INCOMPLETE=false to keep the
		// old lenient behavior.
		const failure = incompleteReviewFailure({ result, filesSelected });
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
