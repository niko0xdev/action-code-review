/**
 * PreLint orchestrator (V3 Phase 2).
 *
 * Runs deterministic static-analysis tools (biome, ruff, mypy, swiftlint,
 * ktlint, sqlfluff, semgrep) against the checked-out repository and
 * surfaces their findings as structured `ToolFinding` records. These are
 * NOT published as PR comments directly - they are injected into the LLM
 * review prompt as evidence so the model can confirm, contradict, or
 * extend them with higher-level reasoning.
 *
 * Design decisions (docs/v3-decisions.md):
 * - Q1: bundle biome + ruff, graceful skip for the rest
 * - Q3: toolFindings exposed in summary via collapsible section
 * - Q5: SQL detection already partially handled in Phase 1; this module
 *       trusts the SQL profile to detect SQL files
 *
 * The orchestrator is opt-in via `AI_REVIEW_ENABLE_PRELINT=true` env var
 * (cannot add a new action input - V1 contract is frozen).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFile } from '../types/context.js';
import type { ToolFinding } from '../types/finding.js';

const PRELINT_TIMEOUT_MS = 60_000;
const MAX_FINDINGS_PER_TOOL = 100;

export interface PrelintOptions {
	/** Repo root path (where the tool runs). */
	repositoryPath: string;
	/** Files changed by the PR (used to scope tool invocations). */
	changedFiles: ChangedFile[];
	/**
	 * Optional timeout override. Defaults to 60s per tool. Tools that
	 * exceed this are skipped (not failed) and noted in diagnostics.
	 */
	timeoutMs?: number;
	/**
	 * If set, override the tool list. Useful for testing. Production
	 * always uses `defaultTools()`.
	 */
	tools?: ToolRunner[];
}

export interface PrelintResult {
	/** Successful findings collected across all tools. */
	findings: ToolFinding[];
	/** Tools that ran successfully. */
	ran: string[];
	/** Tools that were skipped (missing binary, timeout, error). */
	skipped: string[];
}

/**
 * A single static-analysis tool runner. Each runner knows how to:
 * - detect whether its binary is available in the repo
 * - invoke it against the changed files
 * - parse its output into ToolFinding records
 */
export interface ToolRunner {
	/** Identifier surfaced to the LLM (e.g. "biome", "ruff"). */
	readonly id: string;
	/**
	 * Whether the tool is usable in this checkout. Should be cheap
	 * (file existence check or `command -v` style probe).
	 */
	isAvailable(repositoryPath: string): boolean;
	/**
	 * Files this tool can analyze. Used to filter `changedFiles`
	 * before invoking the tool, so we don't waste time on irrelevant
	 * paths (e.g. biome on Python files).
	 */
	matches(file: ChangedFile): boolean;
	/**
	 * Invoke the tool against the filtered file list. Must resolve
	 * with parsed findings even when the tool exited non-zero
	 * (lint findings often exit non-zero).
	 */
	run(args: {
		repositoryPath: string;
		files: ChangedFile[];
		timeoutMs: number;
	}): Promise<ToolFinding[]>;
}

export function findBinary(
	repositoryPath: string,
	binary: string
): string | null {
	const candidates = [
		join(repositoryPath, 'node_modules', '.bin', binary),
		join(repositoryPath, 'node_modules', '.bin', `${binary}.cmd`),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function spawnCollect(
	cmd: string,
	args: string[],
	options: { cwd: string; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd: options.cwd,
			timeout: options.timeoutMs,
			stdio: ['ignore', 'pipe', 'pipe'],
			killSignal: 'SIGKILL',
		});
		let stdout = '';
		let stderr = '';
		let settled = false;
		const finish = (cb: () => void) => {
			if (settled) return;
			settled = true;
			cb();
		};
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			finish(() =>
				reject(new Error(`${cmd} timed out after ${options.timeoutMs}ms`))
			);
		}, options.timeoutMs);
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		child.on('error', (err) => {
			clearTimeout(timer);
			finish(() => reject(err));
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			finish(() => resolve({ stdout, stderr, code: code ?? 0 }));
		});
	});
}

const biomeRunner: ToolRunner = {
	id: 'biome',
	isAvailable: (repo) => findBinary(repo, 'biome') !== null,
	matches: (file) =>
		/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file.filename) &&
		!file.filename.includes('node_modules/'),
	run: async ({ repositoryPath, files, timeoutMs }) => {
		const binary = findBinary(repositoryPath, 'biome');
		if (!binary) return [];
		const fileList = files.map((f) => f.filename);
		const { stdout } = await spawnCollect(
			binary,
			['lint', '--reporter=json', '--max-diagnostics=50', ...fileList],
			{ cwd: repositoryPath, timeoutMs }
		);
		return parseBiomeOutput(stdout);
	},
};

const ruffRunner: ToolRunner = {
	id: 'ruff',
	isAvailable: (repo) => findBinary(repo, 'ruff') !== null,
	matches: (file) => /\.py$/i.test(file.filename),
	run: async ({ repositoryPath, files, timeoutMs }) => {
		const binary = findBinary(repositoryPath, 'ruff');
		if (!binary) return [];
		const fileList = files.map((f) => f.filename);
		const { stdout } = await spawnCollect(
			binary,
			['check', '--output-format=json', '--no-fix', ...fileList],
			{ cwd: repositoryPath, timeoutMs }
		);
		return parseRuffOutput(stdout);
	},
};

interface BiomeDiagnostic {
	filename?: string;
	location?: { path?: string; span?: [number, number] };
	severity?: string;
	category?: string;
	description?: string;
	message?: { desc?: string }[];
}

function parseBiomeOutput(stdout: string): ToolFinding[] {
	let parsed: { diagnostics?: BiomeDiagnostic[] } | BiomeDiagnostic[] | null =
		null;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return [];
	}
	const diagnostics = Array.isArray(parsed)
		? parsed
		: (parsed?.diagnostics ?? []);
	const findings: ToolFinding[] = [];
	for (const d of diagnostics) {
		const filename = d.filename ?? d.location?.path ?? '<unknown>';
		const spanStart = d.location?.span?.[0];
		const line = typeof spanStart === 'number' && spanStart > 0 ? spanStart : 1;
		const severity = mapBiomeSeverity(d.severity);
		const code = d.category ?? 'biome';
		const message =
			d.description ??
			d.message?.map((m) => m.desc ?? '').join(' ') ??
			'(no message)';
		findings.push({
			tool: 'biome',
			code,
			path: filename,
			line,
			severity,
			message,
		});
		if (findings.length >= MAX_FINDINGS_PER_TOOL) break;
	}
	return findings;
}

function mapBiomeSeverity(sev: string | undefined): ToolFinding['severity'] {
	switch (sev) {
		case 'error':
			return 'high';
		case 'warning':
			return 'medium';
		case 'info':
			return 'low';
		default:
			return 'low';
	}
}

interface RuffDiagnostic {
	filename?: string;
	location?: { row?: number };
	code?: string;
	message?: string;
	severity?: string;
	url?: string;
}

function parseRuffOutput(stdout: string): ToolFinding[] {
	let parsed: RuffDiagnostic[] | null = null;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const findings: ToolFinding[] = [];
	for (const d of parsed) {
		const filename = d.filename ?? '<unknown>';
		const line = d.location?.row ?? 1;
		const code = d.code ?? 'ruff';
		const severity = mapRuffSeverity(d.severity);
		findings.push({
			tool: 'ruff',
			code,
			path: filename,
			line,
			severity,
			message: d.message ?? '(no message)',
			docUrl: d.url,
		});
		if (findings.length >= MAX_FINDINGS_PER_TOOL) break;
	}
	return findings;
}

function mapRuffSeverity(sev: string | undefined): ToolFinding['severity'] {
	switch (sev) {
		case 'error':
			return 'high';
		case 'warn':
		case 'warning':
			return 'medium';
		case 'info':
			return 'low';
		default:
			return 'low';
	}
}

export function defaultTools(): ToolRunner[] {
	return [biomeRunner, ruffRunner];
}

export async function runPrelint(
	options: PrelintOptions
): Promise<PrelintResult> {
	const timeoutMs = options.timeoutMs ?? PRELINT_TIMEOUT_MS;
	const tools = options.tools ?? defaultTools();
	const findings: ToolFinding[] = [];
	const ran: string[] = [];
	const skipped: string[] = [];

	for (const tool of tools) {
		if (!tool.isAvailable(options.repositoryPath)) {
			skipped.push(`${tool.id} (binary not found)`);
			continue;
		}
		const matchingFiles = options.changedFiles.filter((f) => tool.matches(f));
		if (matchingFiles.length === 0) {
			skipped.push(`${tool.id} (no matching files)`);
			continue;
		}
		try {
			const toolFindings = await tool.run({
				repositoryPath: options.repositoryPath,
				files: matchingFiles,
				timeoutMs,
			});
			findings.push(...toolFindings);
			ran.push(tool.id);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			skipped.push(`${tool.id} (${reason})`);
		}
	}

	return { findings, ran, skipped };
}

export function renderToolFindingsForPrompt(
	findings: ToolFinding[],
	maxLines = 50
): string {
	if (findings.length === 0) return '(no static-analyzer findings)';
	const lines: string[] = ['Static-analyzer findings (treat as evidence):'];
	for (const finding of findings.slice(0, maxLines)) {
		lines.push(
			`- [${finding.tool}/${finding.code}] ${finding.path}:${finding.line} (${finding.severity}) ${finding.message}`
		);
	}
	if (findings.length > maxLines) {
		lines.push(`... and ${findings.length - maxLines} more findings`);
	}
	return lines.join('\n');
}
