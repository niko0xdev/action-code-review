import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as core from '@actions/core';
import { redactSecrets } from '../security/redaction/redactor.js';
import type { ReviewContext } from '../types/context.js';
import type {
	ReviewResult,
	ReviewUsageMetrics,
	ToolFinding,
} from '../types/finding.js';
import {
	type ReviewHarness,
	buildReviewPrompt,
	parseHarnessFindings,
	toReviewResult,
} from './harness.js';

export const PI_READONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const;
/**
 * Hard ceiling on one harness process' merged stdout+stderr, as a last-resort
 * memory guard.
 *
 * Measured on a real review run: 59 tool calls returned only ~286 KiB of
 * results, while the process emitted 8 MiB of stdout — Pi's JSON event mode
 * writes one JSON line per streamed delta, so even a normal answer is amplified
 * by roughly an order of magnitude. A tight cap therefore kills healthy reviews.
 * The guards that catch an actually broken run are the tool-call ceiling
 * (a loop), the assistant-output ceiling (a provider that rambles), and the
 * process timeout.
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Tool-execution ceiling per harness process; a runaway loop is cut short. */
export const DEFAULT_MAX_TOOL_CALLS = 60;
const MAX_OUTPUT_BYTES = DEFAULT_MAX_OUTPUT_BYTES;
export interface PiHarnessOptions {
	binaryPath?: string;
	timeoutMs?: number;
	provider?: string;
	model?: string;
	apiKey?: string;
	extraRules?: string;
	includeFullContent?: boolean;
	maxContextChars?: number;
	piArgs?: string;
	/** Overrides {@link DEFAULT_MAX_OUTPUT_BYTES}; `0` disables the cap. */
	maxOutputBytes?: number;
	/** Overrides {@link DEFAULT_MAX_TOOL_CALLS}; `0` disables the ceiling. */
	maxToolCalls?: number;
	/** Overrides {@link DEFAULT_MAX_ASSISTANT_BYTES}; `0` disables the ceiling. */
	maxAssistantBytes?: number;
	/**
	 * Extra harness processes allowed when an answer is unparseable. Each repair
	 * attempt re-asks with a bounded "convert your own answer to JSON" prompt
	 * instead of reviewing the diff again.
	 */
	repairAttempts?: number;
	/** Test seam: replaces the real `pi` subprocess spawner. */
	runPi?: typeof runPi;
	/** Test seam: skips runtime config directory discovery. */
	configDir?: string;
	/**
	 * Static-analyzer findings to inject as evidence in the LLM prompt.
	 * Sourced from `context/prelint.ts`. Optional - when omitted, the
	 * prompt is rendered without a tool-findings section (backward
	 * compatible with callers that don't run prelint).
	 */
	toolFindings?: ToolFinding[];
}
const PI_ARGS_ALLOWLIST = new Set([
	'--max-duration',
	'--model-override',
	'--no-session',
]);

export function parsePiArgs(raw: string): string[] {
	if (!raw.trim()) return [];
	const tokens = raw.trim().split(/\s+/);
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (
			tok.includes(';') ||
			tok.includes('|') ||
			tok.includes('&') ||
			tok.includes('`') ||
			tok.includes('$')
		)
			continue;
		if (tok.startsWith('--')) {
			const name = tok.split('=')[0];
			if (!PI_ARGS_ALLOWLIST.has(name) && name !== '--model') continue;
			out.push(tok);
			if (
				!tok.includes('=') &&
				i + 1 < tokens.length &&
				!tokens[i + 1].startsWith('-')
			) {
				out.push(tokens[++i]);
			}
		} else if (tok.startsWith('-')) continue;
		else out.push(tok);
	}
	return out;
}

export function buildPiArgs(
	repositoryPath: string,
	model?: string,
	provider = 'openai',
	extraArgs: string[] = [],
	skillPaths: string[] = []
): string[] {
	const args = [
		// Text mode prints only the final assistant message. `--mode json`
		// re-serializes every streamed delta (and the whole accumulated message
		// with it), which measured out at ~64 MiB of stdout for a 47-tool-call
		// review even though the tool results were ~230 KiB. That amplification
		// killed healthy groups on the process output cap, so the runtime uses
		// text mode and reads provider failures from stderr + non-zero exit.
		'-p',
		'--mode',
		'text',
		'--no-session',
		// Never load project-local TypeScript extensions. Built-in skills are
		// written to the isolated config directory by preparePiRuntimeConfig.
		'--no-extensions',
		'--no-skills',
		'--no-prompt-templates',
		// Context files (AGENTS.md, README.md, etc.) are still off — they
		// are repo-controlled and could leak prompt-injection bait into the
		// review call.
		'--no-context-files',
		'--tools',
		PI_READONLY_TOOLS.join(','),
		'--provider',
		provider,
	];
	if (model) args.push('--model', model);
	for (const skillPath of skillPaths) args.push('--skill', skillPath);
	for (const a of extraArgs) {
		if (a === '--model-override') continue;
		if (a.startsWith('--model-override=')) {
			const v = a.slice('--model-override='.length);
			const mi = args.indexOf('--model');
			if (mi !== -1) args.splice(mi, 2);
			args.push('--model', v);
			continue;
		}
		if (!args.includes(a)) args.push(a);
	}
	// Handle --model-override value token following the flag
	for (let i = 0; i < extraArgs.length; i++) {
		if (extraArgs[i] === '--model-override' && extraArgs[i + 1]) {
			const v = extraArgs[i + 1];
			const mi = args.indexOf('--model');
			if (mi !== -1) args.splice(mi, 2);
			args.push('--model', v);
		}
	}
	args.push(`Review this pull request in ${repositoryPath}. See instructions.`);
	return args;
}
export function buildPiEnv(
	configDir: string,
	apiKey?: string
): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		LANG: process.env.LANG,
		PI_CODING_AGENT_DIR: configDir,
		PI_OFFLINE: process.env.PI_OFFLINE ?? '1',
		...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
		...(process.env.OPENAI_API_URL
			? { OPENAI_API_URL: process.env.OPENAI_API_URL }
			: {}),
		...(process.env.OPENAI_API_MODEL
			? { OPENAI_API_MODEL: process.env.OPENAI_API_MODEL }
			: {}),
	};
}
interface AgentEndEvent {
	type: string;
	message?: {
		role?: string;
		content?: Array<{ type?: string; text?: string }>;
		usage?: unknown;
		stopReason?: string;
		errorMessage?: string;
	};
}

/**
 * Pi reports upstream/API failures inside the assistant `message_end` event as
 * `stopReason: "error"` plus `errorMessage`, with an empty `content` array.
 * Only looking at `content` turned a 401/timeout into "output started with: "
 * and hid the real cause of a failed review, so the error is extracted too.
 */
export function extractAssistantText(stdout: string): string {
	return extractAssistantResult(stdout).text;
}

export interface AssistantResult {
	text: string;
	error?: string;
}

export function extractAssistantResult(stdout: string): AssistantResult {
	const messages: string[] = [];
	let lastError: string | undefined;
	let currentMessage: string[] = [];
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) continue;
		try {
			const event = JSON.parse(trimmed) as AgentEndEvent;
			if (event.type === 'message_end' && event.message?.role === 'assistant') {
				const failure = describeAssistantFailure(event.message);
				if (failure) {
					lastError = failure;
					continue;
				}
				if (!Array.isArray(event.message.content)) continue;
				currentMessage = [];
				for (const block of event.message.content)
					if (block?.type === 'text' && typeof block.text === 'string')
						currentMessage.push(block.text);
				if (currentMessage.length > 0) messages.push(currentMessage.join(''));
			}
		} catch {
			/* ignore non-JSON event lines */
		}
	}
	// Pi can emit multiple assistant messages (for example, a progress answer
	// followed by the final structured artifact). Prefer the last message that
	// contains a JSON object with findings so progress text cannot corrupt the
	// harness parser by being concatenated with the final answer.
	for (let i = messages.length - 1; i >= 0; i--) {
		const candidate = messages[i];
		try {
			const parsed = JSON.parse(candidate) as unknown;
			if (parsed && typeof parsed === 'object' && 'findings' in parsed)
				return lastError
					? { text: candidate, error: lastError }
					: { text: candidate };
		} catch {
			/* Try the next assistant message. */
		}
	}
	if (messages.length === 0 && lastError) return { text: '', error: lastError };
	// Text mode prints the final assistant message verbatim, so stdout is the
	// artifact rather than an event stream. Fall back to the raw output; the
	// JSON scanner tolerates any surrounding prose.
	const text = (messages.at(-1) ?? stdout).trim();
	return lastError ? { text, error: lastError } : { text };
}

/** Human-readable Pi failure, or undefined when the message is not a failure. */
export function describeAssistantFailure(message: {
	stopReason?: string;
	errorMessage?: string;
	content?: unknown[];
}): string | undefined {
	const detail = message.errorMessage?.trim();
	if (detail) return detail;
	if (message.stopReason && message.stopReason !== 'stop') {
		if (message.stopReason === 'length')
			return 'the model response was cut off by the output-token limit';
		if (message.stopReason === 'aborted')
			return 'the model request was aborted';
		if (message.stopReason === 'error') return 'the model request failed';
	}
	return undefined;
}

/**
 * Compact per-tool summary of one harness stream: how many calls each tool
 * made and how many bytes of result came back. A runaway loop is usually
 * "read called 40 times on huge files", and this makes that visible in the
 * action log without dumping megabytes of raw output.
 */
export function summarizeToolCalls(stdout: string): string {
	const calls = new Map<string, { count: number; bytes: number }>();
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) continue;
		try {
			const event = JSON.parse(trimmed) as {
				type?: string;
				toolName?: string;
				result?: unknown;
			};
			if (event.type !== 'tool_execution_end' || !event.toolName) continue;
			const entry = calls.get(event.toolName) ?? { count: 0, bytes: 0 };
			entry.count += 1;
			entry.bytes += JSON.stringify(event.result ?? '').length;
			calls.set(event.toolName, entry);
		} catch {
			/* ignore non-JSON event lines */
		}
	}
	if (calls.size === 0) return 'no tool calls';
	return [...calls.entries()]
		.sort((a, b) => b[1].count - a[1].count)
		.map(
			([name, entry]) =>
				`${name}\u00d7${entry.count} (~${Math.round(entry.bytes / 1024)} KiB of results)`
		)
		.join(', ');
}

/**
 * Cap on assistant-authored text (sum of `text_delta` payloads) before the run
 * is stopped. Tool results are bounded by their own budget, but a provider that
 * streams a runaway answer can push tens of megabytes of deltas through
 * `message_update` events; this attributes that to the model instead of to the
 * process output cap.
 */
export const DEFAULT_MAX_ASSISTANT_BYTES = 512 * 1024;

/** Assistant text bytes streamed so far, counted incrementally per chunk. */
export function countAssistantBytes(stdout: string): number {
	let bytes = 0;
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) continue;
		try {
			const event = JSON.parse(trimmed) as {
				type?: string;
				assistantMessageEvent?: { type?: string; delta?: string };
			};
			if (event.type !== 'message_update') continue;
			if (event.assistantMessageEvent?.type !== 'text_delta') continue;
			const delta = event.assistantMessageEvent.delta;
			if (typeof delta === 'string') bytes += Buffer.byteLength(delta, 'utf8');
		} catch {
			/* ignore non-JSON event lines */
		}
	}
	return bytes;
}

/** Count `tool_execution_start` events in a Pi JSON event stream. */
export function countToolCalls(stdout: string): number {
	let calls = 0;
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) continue;
		try {
			const event = JSON.parse(trimmed) as { type?: string };
			if (event.type === 'tool_execution_start') calls += 1;
		} catch {
			/* ignore non-JSON event lines */
		}
	}
	return calls;
}

/**
 * Emit the per-tool histogram for a failed harness process. Bounded output, so
 * it is always logged: it is the difference between "0 findings" and "the model
 * read the same file 40 times".
 */
function logToolSummary(run: PiRunLog): void {
	core.info(`[harness] tool usage: ${summarizeToolCalls(run.stdout)}`);
}

/** Cap on the rejected answer embedded in a repair prompt, in characters. */
export const MAX_REPAIR_ECHO_CHARS = 4000;

/**
 * Fail with the model/transport error instead of letting an empty answer fall
 * through to the JSON parser, which reported "output started with: " and hid
 * the actual cause (401, timeout, aborted request).
 */
function assertAssistantUsable(assistant: AssistantResult): void {
	if (assistant.error && !assistant.text.trim())
		throw new Error(
			`Pi harness reported an error instead of a review result: ${assistant.error}`
		);
}

/**
 * Build the follow-up prompt used when a harness answer cannot be parsed.
 * The model is asked to convert its own previous answer, not to review again:
 * re-reviewing doubles cost and can produce a different, unverifiable result.
 */
export function buildRepairPrompt(previousOutput: string): string {
	const echo = previousOutput.trim().slice(0, MAX_REPAIR_ECHO_CHARS);
	return [
		'Your previous answer could not be parsed as the required JSON review result.',
		'Do not review the code again and do not call tools. Convert the answer below into exactly one JSON object.',
		'Respond with ONLY the JSON object, no prose, no markdown fence.',
		'Shape: {"findings": [{"severity": "critical|high|medium|low", "confidence": 0.0-1.0, "category": "correctness|security|regression|error-handling|data-integrity|concurrency|performance|maintainability|testing|compatibility", "path": "file/path", "line": <1-based line in the new version>, "rule_id": "stable rule id or null", "title": "...", "description": "...", "impact": "...", "suggestion": "...", "replacement": "exact replacement code or null"}], "summary": "concise overall review summary", "risk": "critical|high|medium|low|none"}',
		'If you found nothing, return {"findings": [], "summary": "No issues found.", "risk": "none"}.',
		'',
		'Previous answer:',
		'<<<',
		echo,
		'>>>',
	].join('\n');
}

/** Per-process token/tool counters parsed from one Pi JSONL run. */
export interface PiUsageCounters {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	assistantMessages: number;
	toolCallsStarted: number;
}

/** A counter the provider may report as nonsense; unknown => 0. */
function counter(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
		return 0;
	// Bound to a safe integer so a bogus huge value cannot poison totals.
	return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

function addCounter(current: number, value: unknown): number {
	const next = current + counter(value);
	return next > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : next;
}

function readUsage(messageUsage: unknown): {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
} | null {
	if (!messageUsage || typeof messageUsage !== 'object') return null;
	const usage = messageUsage as Record<string, unknown>;
	const inputTokens = counter(usage.input);
	const outputTokens = counter(usage.output);
	const cacheReadTokens = counter(usage.cacheRead);
	const cacheWriteTokens = counter(usage.cacheWrite);
	// Prefer the provider's own total; fall back to the component sum when the
	// provider omits it, so a partial shape still yields a usable number.
	const reported = usage.totalTokens;
	const totalTokens =
		typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
			? Math.min(Math.floor(reported), Number.MAX_SAFE_INTEGER)
			: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens,
	};
}

/**
 * Sum provider-reported usage from a single Pi JSONL stdout stream.
 *
 * Only top-level JSON lines are considered. Usage is taken from **completed
 * assistant `message_end` events** only — `message_update` carries cumulative
 * snapshots and summing them would double-count — while
 * `tool_execution_start` events are counted. Malformed lines, malformed usage
 * shapes, and non-finite/negative counters are ignored rather than throwing.
 */
export function parsePiUsage(stdout: string): PiUsageCounters {
	const totals: PiUsageCounters = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		assistantMessages: 0,
		toolCallsStarted: 0,
	};
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) continue;
		let event: AgentEndEvent;
		try {
			event = JSON.parse(trimmed) as AgentEndEvent;
		} catch {
			continue; /* ignore malformed/unrelated lines */
		}
		if (!event || typeof event !== 'object') continue;
		if (event.type === 'tool_execution_start') {
			totals.toolCallsStarted = addCounter(totals.toolCallsStarted, 1);
			continue;
		}
		if (event.type !== 'message_end') continue;
		if (event.message?.role !== 'assistant') continue;
		// Every completed assistant message counts, even when the provider
		// omitted a usage block; only the token sums need a valid shape.
		totals.assistantMessages = addCounter(totals.assistantMessages, 1);
		const usage = readUsage(event.message.usage);
		if (!usage) continue;
		totals.inputTokens = addCounter(totals.inputTokens, usage.inputTokens);
		totals.outputTokens = addCounter(totals.outputTokens, usage.outputTokens);
		totals.cacheReadTokens = addCounter(
			totals.cacheReadTokens,
			usage.cacheReadTokens
		);
		totals.cacheWriteTokens = addCounter(
			totals.cacheWriteTokens,
			usage.cacheWriteTokens
		);
		totals.totalTokens = addCounter(totals.totalTokens, usage.totalTokens);
	}
	return totals;
}

export interface PiRunLog {
	stdout: string;
	stderr: string;
	/** `performance.now()` when the process was spawned. */
	startedAt?: number;
	/** `performance.now()` when the process settled. */
	endedAt?: number;
	/** True when the process timed out, was killed, or exited non-zero. */
	failed?: boolean;
	/** Counters parsed from this run's stdout, retained even on failure. */
	usage?: PiUsageCounters;
}

/**
 * Aggregate per-process logs into report usage. `durationMs` is the wall-clock
 * span from the earliest started process to the latest exit — not the sum of
 * concurrent process durations — and is 0 when no process ran.
 */
export function aggregatePiUsage(
	runs: readonly PiRunLog[]
): ReviewUsageMetrics {
	const metrics: ReviewUsageMetrics = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		assistantMessages: 0,
		toolCallsStarted: 0,
		durationMs: 0,
		processes: { started: runs.length, succeeded: 0, failed: 0 },
	};
	let earliestStart = Number.POSITIVE_INFINITY;
	let latestEnd = Number.NEGATIVE_INFINITY;
	for (const run of runs) {
		if (run.failed) metrics.processes.failed += 1;
		else metrics.processes.succeeded += 1;
		if (typeof run.startedAt === 'number')
			earliestStart = Math.min(earliestStart, run.startedAt);
		if (typeof run.endedAt === 'number')
			latestEnd = Math.max(latestEnd, run.endedAt);
		const usage = run.usage;
		if (!usage) continue;
		metrics.inputTokens = addCounter(metrics.inputTokens, usage.inputTokens);
		metrics.outputTokens = addCounter(metrics.outputTokens, usage.outputTokens);
		metrics.cacheReadTokens = addCounter(
			metrics.cacheReadTokens,
			usage.cacheReadTokens
		);
		metrics.cacheWriteTokens = addCounter(
			metrics.cacheWriteTokens,
			usage.cacheWriteTokens
		);
		metrics.totalTokens = addCounter(metrics.totalTokens, usage.totalTokens);
		metrics.assistantMessages = addCounter(
			metrics.assistantMessages,
			usage.assistantMessages
		);
		metrics.toolCallsStarted = addCounter(
			metrics.toolCallsStarted,
			usage.toolCallsStarted
		);
	}
	if (
		Number.isFinite(earliestStart) &&
		Number.isFinite(latestEnd) &&
		latestEnd >= earliestStart
	)
		metrics.durationMs = Math.floor(latestEnd - earliestStart);
	return metrics;
}

export const AGENT_DEBUG_MAX_CHARS = 60 * 1024;

export function buildAgentDebugSection(
	runs: readonly PiRunLog[]
): string | null {
	if (runs.length === 0) return null;
	const combined = runs
		.map((r, i) => {
			const header =
				runs.length > 1 ? `--- run ${i + 1}/${runs.length} ---\n` : '';
			const err = r.stderr ? `\n[stderr]\n${redactSecrets(r.stderr)}` : '';
			return `${header}${redactSecrets(r.stdout)}${err}`;
		})
		.join('\n\n');
	if (!combined.trim()) return null;
	// Break markdown fence injection from untrusted PR content: \`\`\` and </details> would escape the block.
	let body = combined
		.replaceAll('```', '\\`\\`\\`')
		.replaceAll('</details>', '&lt;/details&gt;');
	let truncated = false;
	if (body.length > AGENT_DEBUG_MAX_CHARS) {
		body = `${body.slice(0, AGENT_DEBUG_MAX_CHARS)}\n\n... truncated (${combined.length - AGENT_DEBUG_MAX_CHARS} chars omitted, total ${combined.length} chars) -- full log in action logs`;
		truncated = true;
	}
	const note = truncated ? ' _(truncated)_' : '';
	return `<details><summary>Agent runtime log (debug)${note}</summary>\n\n\`\`\`\n${body}\n\`\`\`\n\n</details>`;
}

export class PiHarness implements ReviewHarness {
	readonly name = 'pi';
	private _runs: PiRunLog[] = [];
	private resolvedConfigDir: string | null = null;
	constructor(private readonly options: PiHarnessOptions = {}) {}
	get runs(): readonly PiRunLog[] {
		return this._runs;
	}
	get lastRun(): PiRunLog | null {
		return this._runs.length ? this._runs[this._runs.length - 1] : null;
	}
	/**
	 * Provider-reported usage aggregated over every recorded process, including
	 * failed groups that emitted usage before exiting.
	 */
	get usage(): ReviewUsageMetrics {
		return aggregatePiUsage(this._runs);
	}
	private async configDir(): Promise<string> {
		if (this.options.configDir) return this.options.configDir;
		this.resolvedConfigDir ??= await resolveRuntimeConfigDir();
		return this.resolvedConfigDir;
	}
	private async run(prompt: string, context: ReviewContext): Promise<PiRunLog> {
		const configDir = await this.configDir();
		const skillPaths = context.profiles.map((profile) =>
			join(configDir, 'skills', profile.id, 'SKILL.md')
		);
		const runner = this.options.runPi ?? runPi;
		try {
			return await runner({
				binaryPath: this.options.binaryPath ?? 'pi',
				args: buildPiArgs(
					context.repositoryPath,
					this.options.model ?? process.env.OPENAI_API_MODEL,
					this.options.provider ?? 'openai',
					parsePiArgs(this.options.piArgs ?? ''),
					skillPaths
				),
				cwd: context.repositoryPath,
				configDir,
				apiKey: this.options.apiKey,
				prompt,
				timeoutMs: this.options.timeoutMs ?? 15 * 60_000,
				maxOutputBytes: this.options.maxOutputBytes,
				maxToolCalls: this.options.maxToolCalls,
				maxAssistantBytes: this.options.maxAssistantBytes,
			});
		} catch (error) {
			const maybeLog = (error as unknown as Record<string, unknown>)?.piLog as
				| PiRunLog
				| undefined;
			if (maybeLog) this._runs.push(maybeLog);
			if (maybeLog) logToolSummary(maybeLog);
			throw error;
		}
	}
	async review(context: ReviewContext): Promise<ReviewResult> {
		const extraRules = [this.options.extraRules, context.reviewRules]
			.filter((value): value is string => Boolean(value?.trim()))
			.filter((value, index, values) => values.indexOf(value) === index)
			.join('\n\n');
		const prompt = buildReviewPrompt(context, extraRules || undefined, {
			includeFullContent: this.options.includeFullContent,
			maxContextChars: this.options.maxContextChars,
			toolFindings: this.options.toolFindings,
		});
		let run = await this.run(prompt, context);
		this._runs.push(run);
		let assistant = extractAssistantResult(run.stdout);
		assertAssistantUsable(assistant);
		let raw = assistant.text;
		let output: ReturnType<typeof parseHarnessFindings> | undefined;
		try {
			output = parseHarnessFindings(raw);
		} catch (error) {
			// A malformed answer is a model-output problem, not a review result.
			// Re-ask for a conversion of the same answer before giving up, so a
			// single prose reply cannot silently turn the whole PR into
			// "0 findings, all clear".
			const attempts = Math.max(this.options.repairAttempts ?? 1, 0);
			let lastError = error;
			for (let attempt = 0; attempt < attempts; attempt += 1) {
				run = await this.run(buildRepairPrompt(raw), context);
				this._runs.push(run);
				assistant = extractAssistantResult(run.stdout);
				assertAssistantUsable(assistant);
				raw = assistant.text;
				try {
					output = parseHarnessFindings(raw);
					lastError = null;
					break;
				} catch (repairError) {
					lastError = repairError;
				}
			}
			if (lastError) throw lastError;
		}
		if (!output)
			throw new Error(
				'Harness produced no review result after repair attempts.'
			);
		return toReviewResult(
			output,
			context.diff.files.map((f) => f.filename)
		);
	}
}
async function resolveRuntimeConfigDir(): Promise<string> {
	const configDir = process.env.PI_CODING_AGENT_DIR;
	if (configDir) return configDir;
	return mkdtemp(join(tmpdir(), 'acr-pi-test-'));
}
interface RunPiParams {
	binaryPath: string;
	args: string[];
	cwd: string;
	configDir: string;
	apiKey?: string;
	prompt: string;
	timeoutMs: number;
	maxOutputBytes?: number;
	maxToolCalls?: number;
	maxAssistantBytes?: number;
}
function runPi(params: RunPiParams): Promise<PiRunLog> {
	return new Promise((resolve, reject) => {
		const child = spawn(params.binaryPath, params.args, {
			cwd: params.cwd,
			env: buildPiEnv(params.configDir, params.apiKey),
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: process.platform !== 'win32',
		});
		let stdout = '';
		let stderr = '';
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;
		let timedOut = false;
		let toolCalls = 0;
		let assistantBytes = 0;
		/** Bytes already scanned for tool-call events; counting is incremental. */
		let scannedBytes = 0;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const maxBytes = params.maxOutputBytes ?? MAX_OUTPUT_BYTES;
		const maxToolCalls = params.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
		const maxAssistantBytes =
			params.maxAssistantBytes ?? DEFAULT_MAX_ASSISTANT_BYTES;
		// Monotonic span endpoints: the aggregate reports the wall-clock span
		// from the earliest start to the latest exit, not summed durations.
		const startedAt = performance.now();
		let endedAt = 0;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			endedAt = performance.now();
			// Usage is parsed from whatever completed events arrived, even when
			// the process fails: a group that emitted assistant usage and tool
			// starts before dying still contributed work worth reporting.
			const log: PiRunLog = {
				stdout,
				stderr,
				startedAt,
				endedAt,
				failed: Boolean(error),
				usage: parsePiUsage(stdout),
			};
			if (error) {
				(error as unknown as Record<string, unknown>).piLog = log;
				reject(error);
			} else resolve(log);
		};
		const signalProcess = (signal: NodeJS.Signals) => {
			if (process.platform !== 'win32' && child.pid) {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch {
					// Fall back to the direct child when the process group is gone.
				}
			}
			child.kill(signal);
		};
		/** Kill the process group and reject with a diagnosable reason. */
		const killAndFail = (message: string) => {
			if (settled) return;
			signalProcess('SIGKILL');
			finish(new Error(message));
		};
		const timer = setTimeout(() => {
			if (settled) return;
			timedOut = true;
			signalProcess('SIGTERM');
			killTimer = setTimeout(() => {
				signalProcess('SIGKILL');
				finish(
					new Error(`Pi review process timed out after ${params.timeoutMs}ms`)
				);
			}, 250);
		}, params.timeoutMs);
		const append = (
			current: string,
			size: number,
			chunk: Buffer,
			stream: 'stdout' | 'stderr'
		): [string, number] => {
			if (maxBytes > 0 && size + chunk.length > maxBytes) {
				killAndFail(
					`Pi ${stream} output exceeded ${maxBytes} byte cap (tool calls: ${toolCalls})`
				);
				return [current, size];
			}
			return [current + chunk.toString('utf8'), size + chunk.length];
		};
		child.stdout.on('data', (chunk: Buffer) => {
			[stdout, stdoutBytes] = append(stdout, stdoutBytes, chunk, 'stdout');
			if (settled || maxToolCalls <= 0) return;
			// Tool results dominate harness output; cut a runaway tool loop
			// before it consumes the whole review budget. Only the newly
			// appended bytes are scanned, so this stays cheap on big streams.
			const appended = stdout.slice(scannedBytes);
			scannedBytes = stdout.length;
			toolCalls += countToolCalls(appended);
			if (toolCalls > maxToolCalls)
				killAndFail(
					`Pi exceeded the tool-call ceiling (${toolCalls} > ${maxToolCalls}); the review stopped to avoid an unbounded tool loop`
				);
			if (maxAssistantBytes <= 0 || settled) return;
			assistantBytes += countAssistantBytes(appended);
			if (assistantBytes > maxAssistantBytes)
				killAndFail(
					`Pi streamed ${Math.round(assistantBytes / 1024)} KiB of assistant text, over the ${Math.round(maxAssistantBytes / 1024)} KiB model-output ceiling; the provider is looping or echoing instead of answering`
				);
		});
		child.stderr.on('data', (chunk: Buffer) => {
			[stderr, stderrBytes] = append(stderr, stderrBytes, chunk, 'stderr');
		});
		child.stdin.on('error', (error) =>
			finish(new Error(`Failed to write harness prompt: ${error.message}`))
		);
		child.on('error', (error) => {
			clearTimeout(timer);
			finish(new Error(`Failed to start harness: ${error.message}`));
		});
		child.on('close', (code) => {
			if (settled) return;
			if (timedOut) {
				finish(
					new Error(`Pi review process timed out after ${params.timeoutMs}ms`)
				);
				return;
			}
			if (code !== 0)
				finish(
					new Error(
						`Pi review process failed (exit ${code}): ${stderr.slice(-500)}`
					)
				);
			else finish();
		});
		child.stdin.write(params.prompt);
		child.stdin.end();
	});
}
