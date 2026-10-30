import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultTools } from '../../src/context/prelint.js';
import { PiSecurityEngine } from '../../src/security/engines/pi-security-engine.js';
import { runSemgrepScanner } from '../../src/security/scanners/semgrep.js';
import type { SecurityContext } from '../../src/security/types.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const mockSpawn = vi.mocked(spawn);

function fakeProc(stdout = '', code = 0): ChildProcess {
	const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
	proc.stdout = new PassThrough();
	proc.stderr = new PassThrough();
	proc.stdin = new PassThrough();
	proc.pid = 4242;
	proc.kill = () => true;
	setTimeout(() => {
		(proc.stdout as PassThrough).emit('data', Buffer.from(stdout));
		proc.emit('close', code, null);
	}, 50);
	return proc as unknown as ChildProcess;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.OPENAI_API_KEY_TEST_SECRET = 'sk-secret';
	process.env.GITHUB_TOKEN = 'ghs_secret';
});
afterEach(() => {
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

describe('PiSecurityEngine fallback spawn', () => {
	it('reuses the isolated Pi flags and minimal env', async () => {
		const saved = process.env.OPENAI_API_KEY;
		Reflect.deleteProperty(process.env, 'OPENAI_API_KEY');
		mockSpawn.mockReturnValueOnce(fakeProc('{"findings":[]}'));
		const ctx = {
			repo: 'o/r',
			repositoryPath: '/repo',
			options: {},
			changedFiles: [],
		} as unknown as SecurityContext;
		try {
			await new PiSecurityEngine().diff(ctx).catch(() => []);
		} finally {
			if (saved) process.env.OPENAI_API_KEY = saved;
		}
		const { args, env } = lastSpawn();
		for (const flag of ['--no-extensions', '--no-skills', '--no-context-files'])
			expect(args).toContain(flag);
		expect(args).toContain('--tools');
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.OPENAI_API_KEY_TEST_SECRET).toBeUndefined();
	});
});
