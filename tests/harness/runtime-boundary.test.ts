import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPiArgs, buildPiEnv } from '../../src/harness/pi.js';
import { preparePiBoundary } from '../../src/harness/runtime-boundary.js';

const scratch: string[] = [];
afterEach(async () => {
	await Promise.all(
		scratch.splice(0).map((root) => rm(root, { recursive: true, force: true }))
	);
});

describe('trusted review runtime boundary', () => {
	it('uses structured events and isolates home and startup instructions', () => {
		const args = buildPiArgs('/repo');
		expect(args[args.indexOf('--mode') + 1]).toBe('json');
		expect(args).toContain('--system-prompt');
		expect(args).toContain('--append-system-prompt');
		const env = buildPiEnv('/tmp/owned-review');
		expect(env.HOME).toBe('/tmp/owned-review');
		expect(env.XDG_CONFIG_HOME).toBe('/tmp/owned-review');
	});

	it('permits repository source and exact trusted skills while blocking outside paths and links', async () => {
		const root = await mkdtemp(join(tmpdir(), 'acr-boundary-'));
		scratch.push(root);
		const repo = join(root, 'repo');
		const config = join(root, 'config');
		await mkdir(repo);
		await mkdir(config);
		const source = join(repo, 'a.ts');
		const outside = join(root, 'outside');
		const skill = join(config, 'SKILL.md');
		await writeFile(source, 'source');
		await writeFile(outside, 'synthetic canary');
		await writeFile(skill, 'trusted skill');
		await symlink(outside, join(repo, 'link'));
		await mkdir(join(repo, '.git'));
		await writeFile(join(repo, '.git', 'config'), 'credential');
		const extension = await preparePiBoundary(repo, config, [skill]);
		const hooks: Record<
			string,
			(event: { toolName: string; input: { path?: string } }) => unknown
		> = {};
		const module = await import(pathToFileURL(extension).href);
		module.default({
			on: (name: string, hook: (typeof hooks)[string]) => {
				hooks[name] = hook;
			},
		});
		const call = (path?: string, toolName = 'read') => {
			const event = { toolName, input: { path } };
			const result = hooks.tool_call(event) as { block?: boolean } | undefined;
			return { event, result };
		};
		expect(call('a.ts').event.input.path).toBe(await realpath(source));
		expect(call(skill).result?.block).not.toBe(true);
		for (const path of [
			outside,
			'../outside',
			'link',
			'.git/config',
			config,
			`@${outside}`,
			`~/${outside}`,
		]) {
			expect(call(path).result?.block).toBe(true);
		}
		expect(call(undefined, 'grep').event.input.path).toBe(await realpath(repo));
		expect(call('a.ts', 'bash').result?.block).toBe(true);
		expect(await readFile(outside, 'utf8')).toBe('synthetic canary');
	});
	it('gives concurrent subprocesses independent extension files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'acr-boundary-concurrent-'));
		scratch.push(root);
		const paths = await Promise.all(
			Array.from({ length: 6 }, () => preparePiBoundary(root, root))
		);
		expect(new Set(paths).size).toBe(6);
		for (const path of paths)
			expect(await readFile(path, 'utf8')).toContain("pi.on('tool_call'");
	});
});
