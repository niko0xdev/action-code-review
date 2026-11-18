import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultTools, runPrelint } from '../../src/context/prelint.js';
import { runIsolatedPiPrompt } from '../../src/harness/pi.js';
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
		repositoryPath: '',
		options: {},
		changedFiles: [],
	} as unknown as SecurityContext;
	const saved: Record<string, string | undefined> = {};
	const keys = [
		'OPENAI_API_KEY',
		'ANTHROPIC_API_KEY',
		'OPENROUTER_API_KEY',
		'GEMINI_API_KEY',
		'GROQ_API_KEY',
		'MISTRAL_API_KEY',
		'XAI_API_KEY',
		'PI_CODING_AGENT_DIR',
	];
	let engines: PiSecurityEngine[] = [];
	function engine() {
		const instance = new PiSecurityEngine();
		engines.push(instance);
		return instance;
	}
	function assistant(text: string) {
		return JSON.stringify({
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [{ type: 'text', text }],
				stopReason: 'stop',
			},
		});
	}
	beforeEach(async () => {
		const { mkdtemp } = await import('node:fs/promises');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		ctx.repositoryPath = await mkdtemp(join(tmpdir(), 'acr-security-root-'));
		engines = [];
		ctx.options = {} as SecurityOptions;
		for (const k of keys) {
			saved[k] = process.env[k];
			Reflect.deleteProperty(process.env, k);
		}
	});
	afterEach(async () => {
		const { rm } = await import('node:fs/promises');
		await Promise.all(engines.map((e) => e.dispose()));
		await rm(ctx.repositoryPath, { recursive: true, force: true });
		for (const k of keys) {
			if (saved[k] !== undefined) process.env[k] = saved[k];
			else Reflect.deleteProperty(process.env, k);
		}
	});

	it('reuses isolated Pi flags, JSON protocol, and a minimal environment', async () => {
		mockSpawn.mockImplementationOnce(() =>
			fakeProc(assistant('{"findings":[]}'))
		);
		await engine().diff(ctx);
		const { args, env } = lastSpawn();
		for (const flag of ['--no-extensions', '--no-skills', '--no-context-files'])
			expect(args).toContain(flag);
		expect(args[args.indexOf('--mode') + 1]).toBe('json');
		expect(args[args.indexOf('--tools') + 1]).toBe('read,grep,find,ls');
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.OPENAI_API_KEY_TEST_SECRET).toBeUndefined();
		expect(env.HOME).toBe(env.PI_CODING_AGENT_DIR);
		expect(mockSpawn.mock.calls[0][2]?.cwd).toBe(env.PI_CODING_AGENT_DIR);
		expect(mockSpawn.mock.calls[0][2]?.cwd).not.toBe(ctx.repositoryPath);
	});

	it.each([
		['ANTHROPIC_API_KEY', 'anthropic'],
		['OPENROUTER_API_KEY', 'openrouter'],
		['GEMINI_API_KEY', 'google'],
		['GROQ_API_KEY', 'groq'],
		['MISTRAL_API_KEY', 'mistral'],
		['XAI_API_KEY', 'xai'],
	])(
		'forwards only the configured provider key %s and provider %s',
		async (key, provider) => {
			process.env[key] = 'synthetic-provider-key';
			ctx.options = { model: 'gpt-4' } as SecurityOptions;
			process.env.UNRELATED_PROVIDER_SECRET = 'never-forward-this';
			try {
				mockSpawn.mockImplementationOnce(() =>
					fakeProc(assistant('{"findings":[]}'))
				);
				await engine().diff(ctx);
				const { args, env } = lastSpawn();
				expect(args[args.indexOf('--provider') + 1]).toBe(provider);
				expect(env[key]).toBe('synthetic-provider-key');
				expect(args).not.toContain('--model');
				expect(env.GITHUB_TOKEN).toBeUndefined();
				expect(env.UNRELATED_PROVIDER_SECRET).toBeUndefined();
				expect(env.OPENAI_API_KEY_TEST_SECRET).toBeUndefined();
			} finally {
				Reflect.deleteProperty(process.env, 'UNRELATED_PROVIDER_SECRET');
			}
		}
	);

	it.each([
		{ model: 'native-review-model' },
		{ model: 'native-review-model-v2' },
	])('retains explicit native model choices: %j', async (options) => {
		process.env.ANTHROPIC_API_KEY = 'synthetic-provider-key';
		ctx.options = options as SecurityOptions;
		mockSpawn.mockImplementationOnce(() =>
			fakeProc(assistant('{"findings":[]}'))
		);
		await engine().diff(ctx);
		const { args } = lastSpawn();
		expect(args[args.indexOf('--model') + 1]).toBe(options.model);
	});

	it('does not route an ambient native credential to a custom gateway', async () => {
		process.env.ANTHROPIC_API_KEY = 'synthetic-provider-key';
		ctx.options = {
			baseUrl: 'https://gateway.invalid/v1',
			model: 'gateway-review',
		} as SecurityOptions;
		await expect(engine().diff(ctx)).rejects.toThrow(
			/gateway.*explicit API key/i
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('writes the configured gateway and disables compaction in the owned fallback directory', async () => {
		ctx.options = {
			baseUrl: 'https://gateway.invalid/v1',
			model: 'gateway-review',
		} as SecurityOptions;
		mockSpawn.mockImplementationOnce(() =>
			fakeProc(assistant('{"findings":[]}'))
		);
		await engine().diff(ctx);
		const { env } = lastSpawn();
		const { readFile } = await import('node:fs/promises');
		const { join } = await import('node:path');
		const configDir = env.PI_CODING_AGENT_DIR as string;
		const models = JSON.parse(
			await readFile(join(configDir, 'models.json'), 'utf8')
		);
		expect(models.providers.openai.baseUrl).toBe(ctx.options.baseUrl);
		expect(models.providers.openai.models[0].id).toBe(ctx.options.model);
		const settings = JSON.parse(
			await readFile(join(configDir, 'settings.json'), 'utf8')
		);
		expect(settings.compaction.enabled).toBe(false);
	});

	it('disables compaction without replacing built-in alternative provider models', async () => {
		process.env.ANTHROPIC_API_KEY = 'synthetic-provider-key';
		mockSpawn.mockImplementationOnce(() =>
			fakeProc(assistant('{"findings":[]}'))
		);
		await engine().diff(ctx);
		const { env } = lastSpawn();
		const { access, readFile } = await import('node:fs/promises');
		const { join } = await import('node:path');
		const configDir = env.PI_CODING_AGENT_DIR as string;
		await expect(access(join(configDir, 'models.json'))).rejects.toThrow();
		expect(
			JSON.parse(await readFile(join(configDir, 'settings.json'), 'utf8'))
				.compaction.enabled
		).toBe(false);
	});

	it('preserves native provider configuration in a newly allocated isolated transport', async () => {
		const { existsSync, readFileSync } = await import('node:fs');
		const { join } = await import('node:path');
		let configDir = '';
		let hasOverride = true;
		let compactionEnabled = true;
		mockSpawn.mockImplementationOnce((_binary, _args, options) => {
			configDir = (options?.env as NodeJS.ProcessEnv)
				.PI_CODING_AGENT_DIR as string;
			hasOverride = existsSync(join(configDir, 'models.json'));
			compactionEnabled = JSON.parse(
				readFileSync(join(configDir, 'settings.json'), 'utf8')
			).compaction.enabled;
			return fakeProc(assistant('{"findings":[]}'));
		});
		await runIsolatedPiPrompt(
			ctx.repositoryPath,
			'Return a security assessment.',
			{
				provider: 'anthropic',
				extraEnv: { ANTHROPIC_API_KEY: 'synthetic-provider-key' },
			}
		);
		expect(hasOverride).toBe(false);
		expect(compactionEnabled).toBe(false);
		expect(existsSync(configDir)).toBe(false);
	});

	it('reuses one owned config directory for discovery and confirmation, then removes it', async () => {
		const instance = engine();
		mockSpawn.mockImplementationOnce(() =>
			fakeProc(assistant('{"findings":[]}'))
		);
		await instance.diff(ctx);
		mockSpawn.mockImplementation(() =>
			fakeProc(
				assistant('{"confirmed":true,"reason":"The source reaches the sink"}')
			)
		);
		const finding = (id: string) =>
			({
				id,
				severity: 'high',
				confidence: 'medium',
				title: id,
				evidence: [],
			}) as never;
		await instance.confirm(ctx, [finding('a'), finding('b')]);
		const dirs = mockSpawn.mock.calls.map(
			(call) =>
				(call[2] as { env: NodeJS.ProcessEnv }).env
					.PI_CODING_AGENT_DIR as string
		);
		expect(dirs).toHaveLength(3);
		expect(new Set(dirs).size).toBe(1);
		const { access } = await import('node:fs/promises');
		await expect(access(dirs[0])).resolves.toBeUndefined();
		await instance.dispose();
		await expect(access(dirs[0])).rejects.toThrow();
	});

	it('rejects a non-zero exit despite a valid response and keeps the workflow incomplete', async () => {
		mockSpawn.mockImplementation(() =>
			fakeProc(assistant('{"findings":[]}'), 7, 'synthetic failure')
		);
		await expect(engine().diff(ctx)).rejects.toThrow(/exit 7/);
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
		} as SecurityOptions;
		const result = await runSecurityWorkflow({ ...ctx, options }, options, {
			engine: engine(),
			runScanners: async () => ({ findings: [], executions: [] }),
		});
		expect(result.conclusion.engineStatus).toBe('failed');
		expect(result.conclusion.incomplete).toBe(true);
		const { env } = lastSpawn();
		const { access } = await import('node:fs/promises');
		await expect(access(env.PI_CODING_AGENT_DIR as string)).rejects.toThrow();
	});

	it('fails closed for a missing repository root before spawning', async () => {
		await expect(
			engine().diff({ ...ctx, repositoryPath: `${ctx.repositoryPath}/missing` })
		).rejects.toThrow();
		expect(mockSpawn).not.toHaveBeenCalled();
	});
});
