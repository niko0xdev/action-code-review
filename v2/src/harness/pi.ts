import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewContext } from '../types/context.js';
import type { ReviewResult } from '../types/finding.js';
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
	if (model) args.push('--model', model);
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
export class PiHarness implements ReviewHarness {
	readonly name = 'pi';
	constructor(private readonly options: PiHarnessOptions = {}) {}
	async review(context: ReviewContext): Promise<ReviewResult> {
		const stdout = await runPi({
			binaryPath: this.options.binaryPath ?? 'pi',
			args: buildPiArgs(
				context.repositoryPath,
				this.options.model ?? process.env.OPENAI_API_MODEL,
				this.options.provider ?? 'hubworx'
			),
			cwd: context.repositoryPath,
			configDir: await resolveRuntimeConfigDir(),
			apiKey: this.options.apiKey,
			prompt: buildReviewPrompt(context, this.options.extraRules, {
				includeFullContent: this.options.includeFullContent,
				maxContextChars: this.options.maxContextChars,
			}),
			timeoutMs: this.options.timeoutMs ?? 15 * 60_000,
		});
		return toReviewResult(
			parseHarnessFindings(extractAssistantText(stdout)),
			context.diff.files.map((f) => f.filename)
		);
	}
}
async function resolveRuntimeConfigDir(): Promise<string> {
	const configDir = process.env.PI_CONFIG_DIR;
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
function runPi(params: RunPiParams): Promise<string> {
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
			error ? reject(error) : resolve(stdout);
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
