import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewContext } from '../types/context.js';
import type { ReviewResult, ToolFinding } from '../types/finding.js';
import {
	type ReviewHarness,
	buildReviewPrompt,
	parseHarnessFindings,
	toReviewResult,
} from './harness.js';

export const PI_READONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
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
	/**
	 * Static-analyzer findings to inject as evidence in the LLM prompt.
	 * Sourced from `context/prelint.ts`. Optional - when omitted, the
	 * prompt is rendered without a tool-findings section (backward
	 * compatible with V2 callers that don't run prelint).
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
	extraArgs: string[] = []
): string[] {
	const args = [
		'-p',
		'--mode',
		'json',
		'--no-session',
		// Extensions ON so built-in profile skills at
		// ${PI_CODING_AGENT_DIR}/skills/<id>/SKILL.md are discoverable
		// (Pi progressive-disclosure). Keep --no-context-files below to
		// block repo-controlled prompt injection via AGENTS.md/README.md.
		// Skills ARE on now: the runtime copies per-profile SKILL.md files
		// into ${PI_CODING_AGENT_DIR}/skills/<id>/SKILL.md based on the
		// detected profiles. Pi auto-discovers them at startup and progressive-
		// disclosure loads them on demand for matching tasks.
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
	};
}
export function extractAssistantText(stdout: string): string {
	const texts: string[] = [];
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) continue;
		try {
			const event = JSON.parse(trimmed) as AgentEndEvent;
			if (
				event.type === 'message_end' &&
				event.message?.role === 'assistant' &&
				Array.isArray(event.message.content)
			)
				for (const block of event.message.content)
					if (block?.type === 'text' && typeof block.text === 'string')
						texts.push(block.text);
		} catch {
			/* ignore non-JSON event lines */
		}
	}
	return texts.join('\n');
}
export interface PiRunLog {
	stdout: string;
	stderr: string;
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
			const err = r.stderr ? `\n[stderr]\n${r.stderr}` : '';
			return `${header}${r.stdout}${err}`;
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
	constructor(private readonly options: PiHarnessOptions = {}) {}
	get runs(): readonly PiRunLog[] {
		return this._runs;
	}
	get lastRun(): PiRunLog | null {
		return this._runs.length ? this._runs[this._runs.length - 1] : null;
	}
	async review(context: ReviewContext): Promise<ReviewResult> {
		let run: PiRunLog;
		try {
			run = await runPi({
				binaryPath: this.options.binaryPath ?? 'pi',
				args: buildPiArgs(
					context.repositoryPath,
					this.options.model ?? process.env.OPENAI_API_MODEL,
					this.options.provider ?? 'openai',
					parsePiArgs(this.options.piArgs ?? '')
				),
				cwd: context.repositoryPath,
				configDir: await resolveRuntimeConfigDir(),
				apiKey: this.options.apiKey,
				prompt: buildReviewPrompt(context, this.options.extraRules, {
					includeFullContent: this.options.includeFullContent,
					maxContextChars: this.options.maxContextChars,
					toolFindings: this.options.toolFindings,
				}),
				timeoutMs: this.options.timeoutMs ?? 15 * 60_000,
			});
		} catch (error) {
			const maybeLog = (error as unknown as Record<string, unknown>)?.piLog as
				| PiRunLog
				| undefined;
			if (maybeLog) this._runs.push(maybeLog);
			throw error;
		}
		this._runs.push(run);
		return toReviewResult(
			parseHarnessFindings(extractAssistantText(run.stdout)),
			context.diff.files.map((f) => f.filename)
		);
	}
}
async function resolveRuntimeConfigDir(): Promise<string> {
	const configDir = process.env.PI_CODING_AGENT_DIR;
	if (configDir) return configDir;
	return mkdtemp(join(tmpdir(), 'acr-v2-pi-test-'));
}
interface RunPiParams {
	binaryPath: string;
	args: string[];
	cwd: string;
	configDir: string;
	apiKey?: string;
	prompt: string;
	timeoutMs: number;
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
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			if (error) {
				(error as unknown as Record<string, unknown>).piLog = {
					stdout,
					stderr,
				} satisfies PiRunLog;
				reject(error);
			} else resolve({ stdout, stderr });
		};
		const timer = setTimeout(() => {
			if (settled) return;
			child.kill('SIGTERM');
			killTimer = setTimeout(() => child.kill('SIGKILL'), 250);
			finish(
				new Error(`Pi review process timed out after ${params.timeoutMs}ms`)
			);
		}, params.timeoutMs);
		const killAndFail = (stream: 'stdout' | 'stderr') => {
			if (settled) return;
			child.kill('SIGKILL');
			finish(
				new Error(`Pi ${stream} output exceeded ${MAX_OUTPUT_BYTES} byte cap`)
			);
		};
		const append = (
			current: string,
			chunk: unknown,
			stream: 'stdout' | 'stderr'
		) => {
			const text = String(chunk);
			if (
				Buffer.byteLength(current) + Buffer.byteLength(text) >
				MAX_OUTPUT_BYTES
			) {
				killAndFail(stream);
				return current;
			}
			return current + text;
		};
		child.stdout.on('data', (chunk) => {
			stdout = append(stdout, chunk, 'stdout');
		});
		child.stderr.on('data', (chunk) => {
			stderr = append(stderr, chunk, 'stderr');
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
