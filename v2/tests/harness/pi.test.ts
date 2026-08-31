import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	PI_READONLY_TOOLS,
	PiHarness,
	buildPiArgs,
	buildPiEnv,
} from '../../src/harness/pi.js';
import type { ReviewContext } from '../../src/types/context.js';

const scratchRoot = join(tmpdir(), `acr-v2-pi-test-${process.pid}`);

function makeContext(): ReviewContext {
	return {
		repository: { owner: 'acme', repo: 'widget' },
		pullRequest: {
			number: 1,
			title: 't',
			body: '',
			author: 'a',
			headRef: 'h',
			baseRef: 'main',
			headSha: 's1',
			baseSha: 's0',
			draft: false,
		},
		diff: {
			files: [],
			totalAdditions: 0,
			totalDeletions: 0,
		},
		profiles: [],
		repositoryPath: scratchRoot,
	};
}

function writeFakePi(script: string): string {
	const dir = join(scratchRoot, '.bin');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, 'fake-pi');
	writeFileSync(path, script);
	chmodSync(path, 0o755);
	return path;
}

afterEach(() => {
	rmSync(scratchRoot, { recursive: true, force: true });
});

describe('buildPiArgs', () => {
	it('runs non-interactive JSON mode with a read-only toolset', () => {
		const args = buildPiArgs('/repo');
		expect(args).toContain('-p');
		expect(args).toContain('--mode');
		expect(args).toContain('json');
		expect(args).toContain('--tools');
		expect(args[args.indexOf('--tools') + 1].split(',').sort()).toEqual(
			[...PI_READONLY_TOOLS].sort()
		);
	});

	it('disables session storage and context-file discovery', () => {
		const args = buildPiArgs('/repo');
		expect(args).toContain('--no-session');
		expect(args).toContain('--no-context-files');
	});

	it('selects the openai provider and configured model', () => {
		const args = buildPiArgs('/repo', 'gpt-4o-mini');
		expect(args).toContain('--provider');
		expect(args).toContain('openai');
		expect(args).toContain('--model');
		expect(args).toContain('gpt-4o-mini');
	});
});

describe('buildPiEnv', () => {
	it('redirects PI config dir to a runtime directory (never ~/.pi)', () => {
		const env = buildPiEnv('/tmp/runtime-config');
		expect(env.PI_CODING_AGENT_DIR).toBe('/tmp/runtime-config');
	});

	it('keeps PATH so the pi binary resolves', () => {
		const env = buildPiEnv('/tmp/x');
		expect(env.PATH).toBeDefined();
	});
});

describe('PiHarness.review', () => {
	it('parses agent_end text output from a fake pi binary', async () => {
		const payload = JSON.stringify({
			findings: [
				{
					severity: 'critical',
					confidence: 0.97,
					category: 'security',
					path: 'src/x.ts',
					line: 5,
					title: 'SQL injection',
					description: 'Raw interpolation.',
					impact: 'Data leak.',
				},
			],
			summary: 'Critical security issue.',
			risk: 'critical',
		});
		const bin = writeFakePi(
			`#!/bin/sh
cat <<'EOF'
{"type":"session","version":3,"id":"s","timestamp":"t","cwd":"."}
{"type":"agent_start"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"${payload.replace(/"/g, '\\"')}"}]}}
EOF
`
		);
		const harness = new PiHarness({ binaryPath: bin });
		const result = await harness.review(makeContext());
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].title).toBe('SQL injection');
		expect(result.summary).toBe('Critical security issue.');
	});

	it('throws when the harness exits non-zero with diagnostics', async () => {
		const bin = writeFakePi('#!/bin/sh\necho "boom" >&2\nexit 3\n');
		const harness = new PiHarness({ binaryPath: bin });
		await expect(harness.review(makeContext())).rejects.toThrow(
			/Pi review process failed \(exit 3\)/
		);
	});

	it('times out long-running processes', async () => {
		const bin = writeFakePi('#!/bin/sh\nsleep 30\n');
		const harness = new PiHarness({ binaryPath: bin, timeoutMs: 100 });
		await expect(harness.review(makeContext())).rejects.toThrow(/timed out/);
	});

	it('kills a process when stdout exceeds the 50 MiB cap', async () => {
		const bin = writeFakePi('#!/bin/sh\nhead -c 52428801 /dev/zero\n');
		const harness = new PiHarness({ binaryPath: bin, timeoutMs: 10_000 });
		await expect(harness.review(makeContext())).rejects.toThrow(
			/stdout output exceeded 52428800 byte cap/
		);
	});

	it('kills a process when stderr exceeds the 50 MiB cap', async () => {
		const bin = writeFakePi('#!/bin/sh\nhead -c 52428801 /dev/zero >&2\n');
		const harness = new PiHarness({ binaryPath: bin, timeoutMs: 10_000 });
		await expect(harness.review(makeContext())).rejects.toThrow(
			/stderr output exceeded 52428800 byte cap/
		);
	});

	it('reports a clear error when the binary is missing', async () => {
		const harness = new PiHarness({
			binaryPath: join(scratchRoot, 'does-not-exist'),
		});
		await expect(harness.review(makeContext())).rejects.toThrow(
			/not found|ENOENT/i
		);
	});
});
