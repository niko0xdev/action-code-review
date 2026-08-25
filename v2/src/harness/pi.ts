import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import type { ReviewContext } from '../types/context.js';
import type { ReviewResult } from '../types/finding.js';
import {
	type ReviewHarness,
	buildReviewPrompt,
	parseHarnessFindings,
	toReviewResult,
} from './harness.js';

/**
 * Pi coding-agent harness (spec §6/§28/§29).
 *
 * Pi runs as a child process in read-only mode: the review process may
 * inspect the repository but can never modify it (spec §23). Configuration
 * flows from the frozen OPENAI_* env vars into a runtime PI config dir
 * (models.json with a "hubworx" provider) — Pi stays an implementation
 * detail invisible to consumer repositories.
 */

/** Read-only toolset for repository inspection (spec §23 security model). */
export const PI_READONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const;

export interface PiHarnessOptions {
	/** Path to the pi binary. Defaults to "pi" resolved from PATH. */
	binaryPath?: string;
	/** Kill the review after this long (ms). */
	timeoutMs?: number;
	/** Provider name registered in the runtime models.json. */
	provider?: string;
	/** Extra prompt rules appended after the universal rules. */
	extraRules?: string;
}

export function buildPiArgs(
	repositoryPath: string,
	model?: string,
	provider = 'hubworx'
): string[] {
	const args = [
		'-p',
		'--mode',
		'json',
		'--no-session',
		'--no-extensions',
		'--no-skills',
		'--no-prompt-templates',
		'--no-context-files',
		'--tools',
		PI_READONLY_TOOLS.join(','),
		'--provider',
		provider,
	];
	if (model) {
		args.push('--model', model);
	}
	args.push(`Review this pull request in ${repositoryPath}. See instructions.`);
	return args;
}

/**
 * Environment for the Pi child process. PI_CODING_AGENT_DIR points at a
 * runtime-generated config directory so nothing is written to ~/.pi and no
 * host configuration leaks into the review.
 */
export function buildPiEnv(configDir: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		PI_CODING_AGENT_DIR: configDir,
		PI_OFFLINE: process.env.PI_OFFLINE ?? '1',
	};
}

interface AgentEndEvent {
	type: string;
	message?: {
		role?: string;
		content?: Array<{ type?: string; text?: string }>;
	};
}

/** Collect assistant text from pi --mode json event stream. */
export function extractAssistantText(stdout: string): string {
	const texts: string[] = [];
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('{')) {
			continue;
		}
		try {
			const event = JSON.parse(trimmed) as AgentEndEvent;
			if (
				event.type === 'message_end' &&
				event.message?.role === 'assistant' &&
				Array.isArray(event.message.content)
			) {
				for (const block of event.message.content) {
					if (block?.type === 'text' && typeof block.text === 'string') {
						texts.push(block.text);
					}
				}
			}
		} catch {
			// not JSON — skip line
		}
	}
	return texts.join('\n');
}

export class PiHarness implements ReviewHarness {
	readonly name = 'pi';

	constructor(private readonly options: PiHarnessOptions = {}) {}

	async review(context: ReviewContext): Promise<ReviewResult> {
		const binaryPath = this.options.binaryPath ?? 'pi';
		assertBinaryAvailable(binaryPath);

		const stdout = await runPi({
			binaryPath,
			args: buildPiArgs(
				context.repositoryPath,
				process.env.OPENAI_API_MODEL,
				this.options.provider ?? 'hubworx'
			),
			cwd: context.repositoryPath,
			configDir: resolveRuntimeConfigDir(context),
			prompt: buildReviewPrompt(context, this.options.extraRules),
			timeoutMs: this.options.timeoutMs ?? 15 * 60_000,
		});

		const parsed = parseHarnessFindings(extractAssistantText(stdout));
		return toReviewResult(
			parsed,
			context.diff.files.map((f) => f.filename)
		);
	}
}

function assertBinaryAvailable(binaryPath: string): void {
	try {
		accessSync(binaryPath);
	} catch {
		throw new Error(
			`Harness binary not found at "${binaryPath}". Install the coding agent CLI or set V2_HARNESS_BINARY.`
		);
	}
}

function resolveRuntimeConfigDir(_context: ReviewContext): string {
	return process.env.PI_CONFIG_DIR || '/tmp/acr-v2-pi-config';
}

interface RunPiParams {
	binaryPath: string;
	args: string[];
	cwd: string;
	configDir: string;
	prompt: string;
	timeoutMs: number;
}

function runPi(params: RunPiParams): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(params.binaryPath, params.args, {
			cwd: params.cwd,
			env: buildPiEnv(params.configDir),
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let settled = false;

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				child.kill('SIGKILL');
				rejectPromise(
					new Error(`Pi review process timed out after ${params.timeoutMs}ms`)
				);
			}
		}, params.timeoutMs);

		child.stdout.on('data', (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr += String(chunk);
		});
		child.on('error', (error) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				rejectPromise(new Error(`Failed to start harness: ${error.message}`));
			}
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (settled) {
				return;
			}
			settled = true;
			if (code !== 0) {
				rejectPromise(
					new Error(
						`Pi review process failed (exit ${code}): ${stderr.slice(0, 500)}`
					)
				);
				return;
			}
			resolvePromise(stdout);
		});

		child.stdin.write(params.prompt);
		child.stdin.end();
	});
}
