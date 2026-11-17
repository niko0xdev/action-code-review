import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePiRuntimeConfig } from '../../src/adapter/runtime.js';
import { PiHarness } from '../../src/harness/pi.js';
import type { ReviewContext } from '../../src/types/context.js';

async function fixture(
	paths: string[],
	caps: { maxToolCalls?: number; maxAssistantBytes?: number } = {}
) {
	const root = await mkdtemp(join(tmpdir(), 'acr-real-pi-'));
	const repo = join(root, 'repo');
	await mkdir(join(repo, '.pi'), { recursive: true });
	await writeFile(join(repo, '.pi', 'SYSTEM.md'), 'REPOSITORY_SYSTEM_CANARY');
	await writeFile(
		join(repo, '.pi', 'APPEND_SYSTEM.md'),
		'REPOSITORY_APPEND_CANARY'
	);
	await writeFile(join(root, 'outside'), 'OUTSIDE_CREDENTIAL_CANARY');
	await symlink(join(root, 'outside'), join(repo, 'link'));
	await mkdir(join(root, 'outside-dir'));
	await writeFile(
		join(root, 'outside-dir', 'credential'),
		'OUTSIDE_CREDENTIAL_CANARY'
	);
	await mkdir(join(repo, '\u00a0'));
	await writeFile(join(repo, '\u00a0', 'credential'), 'ordinary source');
	await symlink(join(root, 'outside-dir'), join(repo, ' '));
	await writeFile(join(repo, 'a.ts'), 'export const source = "SOURCE_CANARY";');
	const requests: Array<{
		messages: Array<{ role: string; content: unknown }>;
	}> = [];
	const server = createServer(async (req, res) => {
		let raw = '';
		for await (const chunk of req) raw += chunk;
		requests.push(JSON.parse(raw));
		const index = requests.length - 1;
		res.writeHead(200, { 'Content-Type': 'text/event-stream' });
		const chunk = (delta: unknown, finish_reason: string | null = null) =>
			res.write(
				`data: ${JSON.stringify({ id: `mock-${index}`, object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
			);
		if (index < paths.length) {
			chunk({
				role: 'assistant',
				tool_calls: [
					{
						index: 0,
						id: `call-${index}`,
						type: 'function',
						function: {
							name: 'read',
							arguments: JSON.stringify({ path: paths[index] }),
						},
					},
				],
			});
			chunk({}, 'tool_calls');
		} else {
			chunk({
				role: 'assistant',
				content: '{"findings":[],"summary":"complete","risk":"none"}',
			});
			chunk({}, 'stop');
		}
		res.write(
			`data: ${JSON.stringify({ id: `mock-${index}`, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`
		);
		res.end('data: [DONE]\n\n');
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Loopback server did not start.');
	const runtime = await preparePiRuntimeConfig({
		provider: 'openai',
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		apiKey: 'synthetic',
		model: 'mock',
	});
	const harness = new PiHarness({
		binaryPath: resolve('pr-review/pi-runtime/node_modules/.bin/pi'),
		configDir: runtime.configDir,
		apiKey: 'synthetic',
		model: 'mock',
		timeoutMs: 15_000,
		...caps,
	});
	const context: ReviewContext = {
		repository: { owner: 'fixture', repo: 'fixture' },
		repositoryPath: repo,
		pullRequest: {
			number: 1,
			title: 'Fixture',
			body: '',
			author: 'fixture',
			headRef: 'head',
			baseRef: 'main',
			headSha: 'head',
			baseSha: 'base',
			draft: false,
		},
		profiles: [],
		diff: { files: [], totalAdditions: 0, totalDeletions: 0 },
	};
	return {
		harness,
		context,
		requests,
		cleanup: async () => {
			await runtime.cleanup();
			await new Promise<void>((done, reject) =>
				server.close((error) => (error ? reject(error) : done()))
			);
			await rm(root, { recursive: true, force: true });
		},
	};
}

describe('pinned Pi runtime against a loopback provider', () => {
	it('blocks traversal and symlink reads, ignores repository system prompts, and records actual usage', async () => {
		const f = await fixture([
			'../outside',
			'link',
			'\u00a0/credential',
			'a.ts',
		]);
		try {
			const result = await f.harness.review(f.context);
			expect(result.findings).toEqual([]);
			const sent = JSON.stringify(f.requests);
			for (const canary of [
				'OUTSIDE_CREDENTIAL_CANARY',
				'REPOSITORY_SYSTEM_CANARY',
				'REPOSITORY_APPEND_CANARY',
			])
				expect(sent).not.toContain(canary);
			expect(sent).toContain('SOURCE_CANARY');
			expect(f.harness.usage.toolCallsStarted).toBe(4);
			expect(f.harness.usage.totalTokens).toBeGreaterThan(0);
			expect(f.harness.lastRun?.stdout).not.toContain(
				'"type":"message_update"'
			);
		} finally {
			await f.cleanup();
		}
	});
	it('enforces tool-call limits against the real event protocol', async () => {
		const f = await fixture(['a.ts', 'a.ts', 'a.ts'], { maxToolCalls: 1 });
		try {
			await expect(f.harness.review(f.context)).rejects.toThrow(
				/tool-call ceiling/
			);
			expect(f.harness.usage.processes.failed).toBe(1);
		} finally {
			await f.cleanup();
		}
	});
	it('enforces assistant bytes even when the tool ceiling is disabled', async () => {
		const f = await fixture([], { maxToolCalls: 0, maxAssistantBytes: 8 });
		try {
			await expect(f.harness.review(f.context)).rejects.toThrow(
				/model-output ceiling/
			);
		} finally {
			await f.cleanup();
		}
	});
});
