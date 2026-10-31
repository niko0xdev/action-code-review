/**
 * Two-pass verify.
 *
 * After the main review pass, optionally runs a second short LLM call
 * that asks the model to challenge its own high/critical findings.
 * The verify pass is bounded by:
 * - Opt-in via `AI_REVIEW_VERIFY_PASS=true` env var (default false).
 * - Cost ceiling of `AI_REVIEW_VERIFY_BUDGET_USD` (default 0.50 USD).
 * - Skipped when no finding reaches the minimum severity (default high).
 * - `AI_REVIEW_VERIFY_MIN_SEVERITY` (default `high`) widens the set at the
 *   user's own cost.
 *
 * Output: a copy of the input findings without the candidates the model
 * rejected. Survivors are unchanged (the count is recorded in
 * `diagnostics.verifyVerified`). Any error, malformed or partial verdict keeps
 * every finding and marks the review incomplete. Cost is a token estimate
 * (input + output) at a per-1K-token rate, checked before the call.
 */

import {
	escapeControlChars,
	fenced,
	jsonForPrompt,
} from '../shared/prompt-safety.js';
import {
	type Finding,
	type ReviewResult,
	SEVERITY_ORDER,
	type Severity,
	type ToolFinding,
} from '../types/finding.js';
import { computeCounts, riskFromFindings } from './severity.js';

export interface VerifyPassOptions {
	/** Findings from the main pass (post-validation). */
	findings: Finding[];
	/** Original tool findings context for the verify prompt. */
	toolFindings: ToolFinding[];
	/** Original repo + PR context (for the verify prompt). */
	context: {
		title: string;
		body: string;
		filenames: string[];
	};
	/** Function that runs the verify LLM call with its output token ceiling. */
	verify: (prompt: string, maxOutputTokens: number) => Promise<string>;
	/** Estimated input tokens for the verify prompt. */
	inputTokenEstimate: number;
	/** Output tokens requested for the reply; part of the pre-call estimate. */
	outputTokenBudget: number;
	/** Cost ceiling in USD. Default 0.50. */
	budgetUsd?: number;
	/** Per-1K-token USD rate (input + output averaged). Default 0.001 (Haiku-class). */
	ratePer1K?: number;
	/** Lowest severity that is challenged. Default `high` (high and critical). */
	minSeverity?: Severity;
}

export interface VerifyPassResult {
	findings: Finding[];
	verifiedCount: number;
	droppedCount: number;
	skipped: boolean;
	skipReason?: string;
	estimatedCostUsd: number;
	verificationStatus: 'complete' | 'error' | 'incomplete' | 'skipped';
}

const DEFAULT_BUDGET_USD = 0.5;
const DEFAULT_RATE_PER_1K = 0.001;

/**
 * Default floor for a verify pass: high and critical only. Lower severities
 * cost more than they save by default; users can lower the floor with
 * `AI_REVIEW_VERIFY_MIN_SEVERITY`.
 */
export const VERIFY_MIN_SEVERITY_DEFAULT: Severity = 'high';

function isVerifyTarget(severity: Severity, min: Severity): boolean {
	return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[min];
}

/** Candidate id used to match a verdict to a finding: `c1`..`cN` by position. */
function candidateId(index: number): string {
	return `c${index + 1}`;
}

/**
 * Build the verify prompt. The model gets each candidate with a unique id and
 * must return exactly one verdict object per id, `verified` true or false,
 * with a short reason. Rejected candidates are marked false, never omitted;
 * the pass matches verdicts by id only and keeps everything otherwise.
 */
export function buildVerifyPrompt(
	candidates: Finding[],
	toolFindings: ToolFinding[],
	context: { title: string; body: string; filenames: string[] },
	minSeverity: Severity = VERIFY_MIN_SEVERITY_DEFAULT
): string {
	const toolSection = toolFindings.length
		? `\nStatic analyzer evidence (from prelint):\n${toolFindings
				.slice(0, 30)
				.map(
					(f) =>
						`- [${escapeControlChars(f.tool)}/${escapeControlChars(f.code)}] ${escapeControlChars(f.path)}:${f.line} (${f.severity}) ${escapeControlChars(f.message)}`
				)
				.join('\n')}\n`
		: '';
	const withIds = candidates.map((f, i) => ({ ...f, id: candidateId(i) }));
	const floor =
		minSeverity === VERIFY_MIN_SEVERITY_DEFAULT
			? 'high-severity'
			: `${minSeverity}-or-higher severity`;

	return `You are reviewing your OWN findings from a prior code-review pass.
Your job is to challenge each ${floor} finding before it ships to a human reviewer.

PR title: ${escapeControlChars(context.title)}
PR body (truncated):
${fenced(context.body.slice(0, 500))}

Candidate findings to verify (${candidates.length}), each with a unique "id":
${fenced(jsonForPrompt(withIds), 'json')}
${toolSection}

For each finding, answer 3 questions:
1. Is the file path real (matches one of: ${context.filenames.slice(0, 20).map(escapeControlChars).join(', ')})?
2. Is the line number plausible (between 1 and a reasonable file length)?
3. Would a senior engineer agree this is a real bug?

Return exactly ONE verdict object per candidate, using the candidate's "id".
Set "verified": true only if ALL THREE answers are YES, otherwise "verified": false.
Add a short "reason". Do NOT omit any candidate: a rejected finding gets
"verified": false, it is never left out. Do not add ids that were not given.

Return ONLY JSON:
{"verdicts": [{"id": "c1", "verified": true, "reason": "short reason"}, ...]}

Do not invent new findings. Do not change severity. Do not change titles.
This pass exists only to catch hallucinated paths/lines and reasoning shortcuts.`;
}

/** Output tokens per candidate verdict (id, boolean, short reason), generous. */
const VERIFY_TOKENS_PER_CANDIDATE = 120;
const VERIFY_OUTPUT_TOKEN_BASE = 256;
const VERIFY_OUTPUT_TOKEN_CAP = 8192;

/**
 * Output ceiling for `candidates` verdicts: a per-candidate allowance with a
 * base and a cap, so a long candidate list is not truncated into bad JSON.
 */
export function verifyOutputTokenBudget(candidates: number): number {
	return Math.min(
		VERIFY_OUTPUT_TOKEN_CAP,
		VERIFY_OUTPUT_TOKEN_BASE + VERIFY_TOKENS_PER_CANDIDATE * candidates
	);
}

/**
 * Estimate the cost of running the verify pass. Conservative estimate
 * uses input tokens + output budget.
 */
export function estimateCostUsd(
	inputTokens: number,
	outputTokens: number,
	ratePer1K: number
): number {
	return ((inputTokens + outputTokens) / 1000) * ratePer1K;
}

/**
 * Run the verify pass. Always resolves (never throws). When skipped,
 * returns the input findings unchanged with a skip reason.
 */
export async function runVerifyPass(
	options: VerifyPassOptions
): Promise<VerifyPassResult> {
	const budgetUsd = options.budgetUsd ?? DEFAULT_BUDGET_USD;
	const ratePer1K = options.ratePer1K ?? DEFAULT_RATE_PER_1K;

	const minSeverity = options.minSeverity ?? VERIFY_MIN_SEVERITY_DEFAULT;
	const isTarget = (f: Finding) => isVerifyTarget(f.severity, minSeverity);
	const highCritical = options.findings.filter(isTarget);

	if (highCritical.length === 0) {
		return {
			findings: options.findings,
			verifiedCount: 0,
			droppedCount: 0,
			skipped: true,
			skipReason:
				minSeverity === VERIFY_MIN_SEVERITY_DEFAULT
					? 'no high/critical findings to verify'
					: `no ${minSeverity}+ findings to verify`,
			estimatedCostUsd: 0,
			verificationStatus: 'skipped',
		};
	}

	const prompt = buildVerifyPrompt(
		highCritical,
		options.toolFindings,
		options.context,
		minSeverity
	);

	// Cost gate, checked before the call. The caller's estimate is raised to
	// the real prompt size so the gate never undercounts what is sent.
	const estimatedCostUsd = estimateCostUsd(
		Math.max(options.inputTokenEstimate, Math.ceil(prompt.length / 4)),
		options.outputTokenBudget,
		ratePer1K
	);
	if (!(estimatedCostUsd <= budgetUsd)) {
		return {
			findings: options.findings,
			verifiedCount: 0,
			droppedCount: 0,
			skipped: true,
			skipReason: `estimated cost $${estimatedCostUsd.toFixed(3)} exceeds budget $${budgetUsd}`,
			estimatedCostUsd,
			verificationStatus: 'skipped',
		};
	}

	let raw: string;
	try {
		raw = await options.verify(prompt, options.outputTokenBudget);
	} catch (error) {
		return {
			findings: options.findings,
			verifiedCount: 0,
			droppedCount: 0,
			skipped: true,
			skipReason: `verify call failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
			estimatedCostUsd,
			verificationStatus: 'error',
		};
	}

	const parsed = parseVerifyOutput(raw, highCritical.length);
	if (parsed.status !== 'complete') {
		return {
			findings: options.findings,
			verifiedCount: 0,
			droppedCount: 0,
			skipped: true,
			skipReason: parsed.reason,
			estimatedCostUsd,
			verificationStatus: parsed.status,
		};
	}

	// Build verified output: keep highCritical that survived verification,
	// plus all other findings (unchanged).
	const rejected = new Set<Finding>();
	let verifiedCount = 0;
	highCritical.forEach((f, i) => {
		if (parsed.verdicts.get(candidateId(i))) verifiedCount += 1;
		else rejected.add(f);
	});
	const surviving = options.findings.filter((f) => !rejected.has(f));

	return {
		findings: surviving,
		verifiedCount,
		droppedCount: rejected.size,
		skipped: false,
		estimatedCostUsd,
		verificationStatus: 'complete',
	};
}

/** Default budget (USD) for the pipeline verify pass. */
export const VERIFY_BUDGET_USD_DEFAULT = 0.5;

/**
 * Apply `runVerifyPass` to a pipeline `ReviewResult` in place: replaces
 * findings with survivors, recomputes counts + risk, and records
 * verify stats on `result.diagnostics`. Never throws — any failure
 * leaves the input result unchanged with the skip reason recorded.
 */
export async function applyVerifyPass(
	result: ReviewResult,
	args: {
		toolFindings: ToolFinding[];
		title: string;
		body: string;
		verify: (prompt: string, maxOutputTokens: number) => Promise<string>;
		budgetUsd?: number;
		minSeverity?: Severity;
	}
): Promise<void> {
	const outcome = await runVerifyPass({
		findings: result.findings,
		toolFindings: args.toolFindings,
		context: {
			title: args.title,
			body: args.body,
			filenames: result.filesReviewed,
		},
		verify: args.verify,
		inputTokenEstimate: estimateVerifyInputTokens(
			result.findings,
			args.toolFindings
		),
		outputTokenBudget: verifyOutputTokenBudget(
			result.findings.filter((f) =>
				isVerifyTarget(
					f.severity,
					args.minSeverity ?? VERIFY_MIN_SEVERITY_DEFAULT
				)
			).length
		),
		budgetUsd: args.budgetUsd ?? VERIFY_BUDGET_USD_DEFAULT,
		minSeverity: args.minSeverity,
	});
	if (outcome.skipped) {
		result.diagnostics = {
			...result.diagnostics,
			verifySkippedReason: outcome.skipReason,
			verifyCostUsd: outcome.estimatedCostUsd,
			verifyStatus: outcome.verificationStatus,
		};
		if (
			outcome.verificationStatus === 'error' ||
			outcome.verificationStatus === 'incomplete'
		)
			result.reviewStatus = 'incomplete';
		return;
	}
	result.findings = outcome.findings;
	result.counts = computeCounts(outcome.findings);
	result.risk = riskFromFindings(outcome.findings);
	result.diagnostics = {
		...result.diagnostics,
		verifyVerified: outcome.verifiedCount,
		verifyDropped: outcome.droppedCount,
		verifyCostUsd: outcome.estimatedCostUsd,
		verifyStatus: outcome.verificationStatus,
	};
}

/** Rough input estimate: ~4 chars/token over the verify prompt inputs. */
function estimateVerifyInputTokens(
	findings: Finding[],
	toolFindings: ToolFinding[]
): number {
	const chars =
		JSON.stringify(findings).length + JSON.stringify(toolFindings).length;
	return Math.ceil(chars / 4);
}

interface VerifyOutput {
	verdicts?: unknown;
}

/**
 * Strict parser. A verdict counts only when it is an object with a known
 * candidate id that appears exactly once and a boolean `verified`. Anything
 * else is ignored, and unless every candidate ends up with a valid verdict the
 * result is `incomplete` and the caller keeps every finding.
 */
function parseVerifyOutput(
	raw: string,
	candidateCount: number
): {
	verdicts: Map<string, boolean>;
	status: 'complete' | 'error' | 'incomplete';
	reason?: string;
} {
	const none = new Map<string, boolean>();
	// Best-effort JSON extraction. The LLM may include prose; we look for
	// the first {...} block.
	const jsonStart = raw.indexOf('{');
	const jsonEnd = raw.lastIndexOf('}');
	if (jsonStart < 0 || jsonEnd <= jsonStart)
		return {
			verdicts: none,
			status: 'error',
			reason: 'verify output was not JSON; findings retained',
		};
	let parsed: VerifyOutput | null = null;
	try {
		parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
	} catch {
		return {
			verdicts: none,
			status: 'error',
			reason: 'verify output JSON was malformed; findings retained',
		};
	}
	if (!parsed || !Array.isArray(parsed.verdicts))
		return {
			verdicts: none,
			status: 'incomplete',
			reason:
				'verify output did not include a verdicts list; findings retained',
		};

	const known = new Set(
		Array.from({ length: candidateCount }, (_, i) => candidateId(i))
	);
	const verdicts = new Map<string, boolean>();
	const duplicated = new Set<string>();
	for (const item of parsed.verdicts as unknown[]) {
		const v = item as { id?: unknown; verified?: unknown } | null;
		if (!v || typeof v.id !== 'string' || !known.has(v.id)) continue;
		if (typeof v.verified !== 'boolean') continue;
		if (verdicts.has(v.id)) duplicated.add(v.id);
		else verdicts.set(v.id, v.verified);
	}
	for (const id of duplicated) verdicts.delete(id);
	if (verdicts.size !== candidateCount)
		return {
			verdicts: none,
			status: 'incomplete',
			reason:
				'verify output lacked one valid verdict per candidate; findings retained',
		};
	return { verdicts, status: 'complete' };
}
