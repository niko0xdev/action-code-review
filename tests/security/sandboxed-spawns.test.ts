import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultTools, runPrelint } from '../../src/context/prelint.js';
import { MAX_ANALYSER_OUTPUT_BYTES } from '../../src/security/analyser-process.js';
import { PiSecurityEngine } from '../../src/security/engines/pi-security-engine.js';
import { runSecurityWorkflow } from '../../src/security/orchestrator.js';
import { runSemgrepScanner } from '../../src/security/scanners/semgrep.js';
import type {
	SecurityContext,
	SecurityOptions,
} from '../../src/security/types.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const mockSpawn = vi.mocked(spawn);

function fakeProc(
	stdout: string | Buffer = '',
	code = 0,
	stderr = ''
): ChildProcess {
	const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
	proc.stdout = new PassThrough();
	proc.stderr = new PassThrough();
	proc.stdin = new PassThrough();
	proc.pid = 4242;
	proc.kill = () => true;
	setTimeout(() => {
		if (stderr) (proc.stderr as PassThrough).emit('data', Buffer.from(stderr));
		(proc.stdout as PassThrough).emit('data', Buffer.from(stdout));
		proc.emit('close', code, null);
	}, 50);
	return proc as unknown as ChildProcess;
}

let killSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	vi.clearAllMocks();
	killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
	process.env.OPENAI_API_KEY_TEST_SECRET = 'sk-secret';
	process.env.GITHUB_TOKEN = 'ghs_secret';
});
afterEach(() => {
	killSpy.mockRestore();
	Reflect.deleteProperty(process.env, 'OPENAI_API_KEY_TEST_SECRET');
	Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
});

function lastSpawn() {
	const [cmd, args, opts] = mockSpawn.mock.calls.at(-1) as unknown as [
		string,
		string[],
		{ env: NodeJS.ProcessEnv },
	];
	return { cmd, args, env: opts.env };
}

describe('Semgrep spawn hardening', () => {
	it('uses a minimal env, `--`, and drops dash-prefixed files', async () => {
		mockSpawn.mockReturnValueOnce(
			fakeProc(JSON.stringify({ results: [], errors: [] }))
		);
		await runSemgrepScanner('/repo', ['--config=evil', 'src/a.py']);
		const { args, env } = lastSpawn();
		expect(args.slice(-2)).toEqual(['--', 'src/a.py']);
		expect(args).not.toContain('--config=evil');
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.OPENAI_API_KEY_TEST_SECRET).toBeUndefined();
		expect(env.SEMGREP_SEND_METRICS).toBe('off');
	});

	it('skips without spawning when every file is dash-prefixed', async () => {
		const res = await runSemgrepScanner('/repo', ['--config=evil']);
		expect(res.execution.status).toBe('skipped');
		expect(mockSpawn).not.toHaveBeenCalled();
	});
});

describe('prelint spawn hardening', () => {
	it('passes `--`, drops dash-prefixed files, and hides secrets', async () => {
		const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const dir = mkdtempSync(join(tmpdir(), 'acr-trusted-'));
		const bin = join(dir, 'ruff');
		writeFileSync(bin, '#!/bin/sh\n');
		chmodSync(bin, 0o755);
		process.env.AI_REVIEW_TRUSTED_ANALYZER_DIR = dir;
		try {
			mockSpawn.mockReturnValueOnce(fakeProc('[]'));
			const ruff = defaultTools().find((t) => t.id === 'ruff');
			const file = (filename: string) => ({
				filename,
				status: 'modified' as const,
				additions: 1,
				deletions: 0,
				changes: 1,
			});
			await ruff?.run({
				repositoryPath: dir,
				files: [file('--config=evil'), file('a.py')],
				timeoutMs: 5000,
			});
			const { args, env } = lastSpawn();
			expect(args.slice(-2)).toEqual(['--', 'a.py']);
			expect(env.GITHUB_TOKEN).toBeUndefined();
			expect(env.PATH).toBeDefined();
		} finally {
			Reflect.deleteProperty(process.env, 'AI_REVIEW_TRUSTED_ANALYZER_DIR');
		}
	});
});

describe('prelint output cap and failures', () => {
	async function trustedRuff() {
		const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const dir = mkdtempSync(join(tmpdir(), 'acr-trusted-'));
		const bin = join(dir, 'ruff');
		writeFileSync(bin, '#!/bin/sh\n');
		chmodSync(bin, 0o755);
		process.env.AI_REVIEW_TRUSTED_ANALYZER_DIR = dir;
		return dir;
	}
	const pyFile = {
		filename: 'a.py',
		status: 'modified' as const,
		additions: 1,
		deletions: 0,
		changes: 1,
	};

	afterEach(() => {
		Reflect.deleteProperty(process.env, 'AI_REVIEW_TRUSTED_ANALYZER_DIR');
	});

	it('kills the process group and skips the tool when output exceeds the cap', async () => {
		const dir = await trustedRuff();
		mockSpawn.mockReturnValueOnce(
			fakeProc(Buffer.alloc(MAX_ANALYSER_OUTPUT_BYTES + 1))
		);
		const res = await runPrelint({
			repositoryPath: dir,
			changedFiles: [pyFile],
		});
		expect(res.ran).toEqual([]);
		expect(res.skipped.join()).toContain('byte cap');
		expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
	});

	it('reports a non-zero exit with no output as a tool failure, not clean', async () => {
		const dir = await trustedRuff();
		mockSpawn.mockReturnValueOnce(fakeProc('', 127, 'missing library'));
		const res = await runPrelint({
			repositoryPath: dir,
			changedFiles: [pyFile],
		});
		expect(res.ran).toEqual([]);
		expect(res.skipped.join()).toContain('exited 127');
	});

	it('still accepts a non-zero exit that carries a report', async () => {
		const dir = await trustedRuff();
		mockSpawn.mockReturnValueOnce(fakeProc('[]', 1));
		const res = await runPrelint({
			repositoryPath: dir,
			changedFiles: [pyFile],
		});
		expect(res.ran).toEqual(['ruff']);
	});
});

describe('Semgrep output cap', () => {
	it('kills the process group and reports failed', async () => {
		mockSpawn.mockReturnValueOnce(
			fakeProc(Buffer.alloc(MAX_ANALYSER_OUTPUT_BYTES + 1))
		);
		const res = await runSemgrepScanner('/repo', ['a.py']);
		expect(res.execution.status).toBe('failed');
		expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
	});
});

describe('PiSecurityEngine fallback spawn', () => {
	const ctx = {
		owner: 'o',
		repo: 'r',
		repositoryPath: '/repo',
		options: {},
		changedFiles: [],
	} as unknown as SecurityContext;
	const saved: Record<string, string | undefined> = {};
	const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PI_CODING_AGENT_DIR'];

	beforeEach(() => {
		for (const k of keys) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
	});
	afterEach(() => {
		for (const k of keys) {
			if (saved[k] !== undefined) process.env[k] = saved[k];
			else Reflect.deleteProperty(process.env, k);
		}
	});

	it('reuses the isolated Pi flags and minimal env', async () => {
		mockSpawn.mockReturnValueOnce(fakeProc('{"findings":[]}'));
		await new PiSecurityEngine().diff(ctx);
		const { args, env } = lastSpawn();
		for (const flag of ['--no-extensions', '--no-skills', '--no-context-files'])
			expect(args).toContain(flag);
		expect(args).toContain('--tools');
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.OPENAI_API_KEY_TEST_SECRET).toBeUndefined();
	});

	it('forwards only the configured provider key and its provider id', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
		mockSpawn.mockReturnValueOnce(fakeProc('{"findings":[]}'));
		await new PiSecurityEngine().diff(ctx);
		const { args, env } = lastSpawn();
		expect(args[args.indexOf('--provider') + 1]).toBe('anthropic');
		expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.OPENAI_API_KEY_TEST_SECRET).toBeUndefined();
	});

	it('creates one config directory per engine run, not per finding', async () => {
		const engine = new PiSecurityEngine();
		mockSpawn.mockImplementation(() => fakeProc('{"confirmed":true}'));
		const finding = (id: string) =>
			({
				id,
				severity: 'high',
				confidence: 'medium',
				title: id,
				evidence: [],
			}) as never;
		await engine.confirm(ctx, [finding('a'), finding('b')]).catch(() => []);
		const dirs = mockSpawn.mock.calls.map(
			(c) =>
				(c[2] as { env: NodeJS.ProcessEnv }).env.PI_CODING_AGENT_DIR as string
		);
		expect(dirs.length).toBeGreaterThanOrEqual(2);
		expect(new Set(dirs).size).toBe(1);
		mockSpawn.mockReset();
	});

	it('rejects on a non-zero Pi exit and the workflow ends incomplete', async () => {
		mockSpawn.mockImplementation((cmd: string) => {
			if (cmd === 'semgrep') {
				const err = new Error('spawn semgrep ENOENT') as NodeJS.ErrnoException;
				err.code = 'ENOENT';
				const proc = fakeProc();
				setTimeout(() => proc.emit('error', err), 10);
				return proc;
			}
			return fakeProc('', 1, 'boom');
		});
		await expect(new PiSecurityEngine().diff(ctx)).rejects.toThrow(/exit 1/);
		const options = {
			mode: 'security',
			profile: 'diff',
			minSeverity: 'medium',
			failOn: 'critical',
			confirmFindings: false,
			inlineComments: false,
			stickyComment: false,
			generateSarif: false,
			maxFindings: 10,
			riskThreshold: 'high',
		} as unknown as SecurityOptions;
		const result = await runSecurityWorkflow(
			{ ...ctx, options, changedFiles: [] } as SecurityContext,
			options
		);
		expect(result.conclusion.engineStatus).toBe('failed');
		expect(result.conclusion.incomplete).toBe(true);
		mockSpawn.mockReset();
	});
});
