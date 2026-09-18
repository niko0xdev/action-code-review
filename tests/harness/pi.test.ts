import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	AGENT_DEBUG_MAX_CHARS,
	PI_READONLY_TOOLS,
	PiHarness,
	aggregatePiUsage,
	buildAgentDebugSection,
	buildPiArgs,
	buildPiEnv,
	extractAssistantText,
	parsePiUsage,
} from '../../src/harness/pi.js';
import type { PiRunLog } from '../../src/harness/pi.js';
import type { ReviewContext } from '../../src/types/context.js';

const scratchRoot = join(tmpdir(), `acr-pi-test-${process.pid}`);

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

describe('extractAssistantText', () => {
	it('selects the final structured assistant message', () => {
		const progress = JSON.stringify({ type: 'progress' });
		const first = JSON.stringify({
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: 'Working…' }],
			},
		});
		const final = JSON.stringify({
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: '{"findings":[],"summary":"done"}' }],
			},
		});
		expect(extractAssistantText(`${progress}\n${first}\n${final}`)).toBe(
			'{"findings":[],"summary":"done"}'
		);
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

	it('records usage from a completed run and keeps it off a failed one', async () => {
		const bin = writeFakePi(`#!/bin/sh
cat <<'EOF'
{"type":"message_end","message":{"role":"assistant","usage":{"input":10,"output":4,"cacheRead":2,"cacheWrite":1,"totalTokens":17},"content":[{"type":"text","text":"{\\"findings\\":[],\\"summary\\":\\"ok\\",\\"risk\\":\\"none\\"}"}]}}
{"type":"tool_execution_start","toolName":"read"}
EOF
`);
		const harness = new PiHarness({ binaryPath: bin });
		await harness.review(makeContext());
		expect(harness.usage).toEqual({
			inputTokens: 10,
			outputTokens: 4,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
			totalTokens: 17,
			assistantMessages: 1,
			toolCallsStarted: 1,
			durationMs: expect.any(Number),
			processes: { started: 1, succeeded: 1, failed: 0 },
		});
	});

	it('retains usage observed before a process fails', async () => {
		const bin = writeFakePi(`#!/bin/sh
cat <<'EOF'
{"type":"message_end","message":{"role":"assistant","usage":{"input":7,"output":3,"totalTokens":10},"content":[{"type":"text","text":"partial"}]}}
{"type":"tool_execution_start"}
EOF
echo "boom" >&2
exit 4
`);
		const harness = new PiHarness({ binaryPath: bin });
		await expect(harness.review(makeContext())).rejects.toThrow(/exit 4/);
		const usage = harness.usage;
		expect(usage.inputTokens).toBe(7);
		expect(usage.outputTokens).toBe(3);
		expect(usage.assistantMessages).toBe(1);
		expect(usage.toolCallsStarted).toBe(1);
		expect(usage.processes).toEqual({ started: 1, succeeded: 0, failed: 1 });
	});

	it('marks a timed-out process as failed but keeps its observed usage', async () => {
		const bin = writeFakePi(`#!/bin/sh
cat <<'EOF'
{"type":"message_end","message":{"role":"assistant","usage":{"input":5,"output":1,"totalTokens":6},"content":[{"type":"text","text":"started"}]}}
EOF
sleep 30
`);
		const harness = new PiHarness({ binaryPath: bin, timeoutMs: 600 });
		await expect(harness.review(makeContext())).rejects.toThrow(/timed out/);
		expect(harness.usage.inputTokens).toBe(5);
		expect(harness.usage.processes).toEqual({
			started: 1,
			succeeded: 0,
			failed: 1,
		});
	});

	it('marks a spawn failure as a failed process without poisoning totals', async () => {
		const harness = new PiHarness({
			binaryPath: join(scratchRoot, 'does-not-exist'),
		});
		await expect(harness.review(makeContext())).rejects.toThrow(
			/not found|ENOENT/i
		);
		expect(harness.usage.processes).toEqual({
			started: 1,
			succeeded: 0,
			failed: 1,
		});
		expect(harness.usage.inputTokens).toBe(0);
		expect(harness.usage.totalTokens).toBe(0);
	});
});

describe('parsePiUsage', () => {
	it('sums completed assistant usage and counts tool starts', () => {
		const stdout = [
			'{"type":"message_update","message":{"role":"assistant","usage":{"input":999,"output":999,"totalTokens":1998}}}',
			'{"type":"message_end","message":{"role":"assistant","usage":{"input":10,"output":4,"cacheRead":2,"cacheWrite":1,"totalTokens":17},"content":[]}}',
			'{"type":"tool_execution_start","toolName":"read"}',
			'{"type":"tool_execution_start","toolName":"grep"}',
			'{"type":"message_end","message":{"role":"assistant","usage":{"input":3,"output":2,"cacheRead":0,"cacheWrite":0,"totalTokens":5},"content":[]}}',
		].join('\n');
		expect(parsePiUsage(stdout)).toEqual({
			inputTokens: 13,
			outputTokens: 6,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
			totalTokens: 22,
			assistantMessages: 2,
			toolCallsStarted: 2,
		});
	});

	it('counts every completed assistant message even without usage', () => {
		const stdout = [
			'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
			'{"type":"message_end","message":{"role":"assistant","content":[]}}',
		].join('\n');
		const usage = parsePiUsage(stdout);
		expect(usage.assistantMessages).toBe(2);
		expect(usage.inputTokens).toBe(0);
		expect(usage.totalTokens).toBe(0);
	});

	it('ignores malformed lines, non-assistant messages and bad counters', () => {
		const stdout = [
			'not json at all',
			'{"type":"message_end","message":{"role":"user","usage":{"input":100,"output":100,"totalTokens":200}}}',
			'{"type":"message_end","message":{"role":"assistant","usage":"nonsense","content":[]}}',
			'{"type":"message_end","message":{"role":"assistant","usage":{"input":-5,"output":-1,"cacheRead":null,"cacheWrite":"x","totalTokens":-3},"content":[]}}',
			'{"type":"message_end","message":{"role":"assistant","usage":{"input":1.5e999,"output":2,"totalTokens":4},"content":[]}}',
		].join('\n');
		const usage = parsePiUsage(stdout);
		expect(usage).toEqual({
			inputTokens: 0,
			outputTokens: 2,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 4,
			assistantMessages: 3,
			toolCallsStarted: 0,
		});
	});

	it('derives the total from components when the provider omits it', () => {
		const usage = parsePiUsage(
			'{"type":"message_end","message":{"role":"assistant","usage":{"input":4,"output":6,"cacheRead":1,"cacheWrite":2},"content":[]}}'
		);
		expect(usage.totalTokens).toBe(13);
	});

	it('returns zeroed counters for empty or non-JSON output', () => {
		const zero = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
			assistantMessages: 0,
			toolCallsStarted: 0,
		};
		expect(parsePiUsage('')).toEqual(zero);
		expect(parsePiUsage('<html>not events</html>')).toEqual(zero);
	});
});

describe('aggregatePiUsage', () => {
	function run(overrides: Partial<PiRunLog> = {}): PiRunLog {
		return { stdout: '', stderr: '', startedAt: 0, endedAt: 0, ...overrides };
	}

	it('sums counters across processes and reports process counts', () => {
		const usage = aggregatePiUsage([
			run({
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: 1,
					cacheWriteTokens: 0,
					totalTokens: 16,
					assistantMessages: 1,
					toolCallsStarted: 2,
				},
			}),
			run({
				failed: true,
				usage: {
					inputTokens: 4,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalTokens: 6,
					assistantMessages: 1,
					toolCallsStarted: 1,
				},
			}),
		]);
		expect(usage.inputTokens).toBe(14);
		expect(usage.totalTokens).toBe(22);
		expect(usage.assistantMessages).toBe(2);
		expect(usage.toolCallsStarted).toBe(3);
		expect(usage.processes).toEqual({ started: 2, succeeded: 1, failed: 1 });
	});

	it('reports the wall-clock span of overlapping processes, not the sum', () => {
		// Two groups overlap inside a 100ms window; summing durations would be 120.
		const usage = aggregatePiUsage([
			run({ startedAt: 0, endedAt: 80 }),
			run({ startedAt: 20, endedAt: 100 }),
		]);
		expect(usage.durationMs).toBe(100);
	});

	it('reports zero duration and no processes when nothing ran', () => {
		expect(aggregatePiUsage([])).toEqual({
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
			assistantMessages: 0,
			toolCallsStarted: 0,
			durationMs: 0,
			processes: { started: 0, succeeded: 0, failed: 0 },
		});
	});
});

describe('buildAgentDebugSection', () => {
	it('returns null when no runs or only blank output', () => {
		expect(buildAgentDebugSection([])).toBeNull();
		expect(
			buildAgentDebugSection([{ stdout: '   \n  ', stderr: '' }])
		).toBeNull();
	});

	it('wraps a single run in a collapsed details block', () => {
		const section = buildAgentDebugSection([
			{ stdout: 'review output', stderr: '' },
		]);
		expect(section).toContain(
			'<details><summary>Agent runtime log (debug)</summary>'
		);
		expect(section).toContain('review output');
	});

	it('numbers multiple runs and appends stderr', () => {
		const section = buildAgentDebugSection([
			{ stdout: 'first', stderr: 'warn' },
			{ stdout: 'second', stderr: '' },
		]);
		expect(section).toContain('--- run 1/2 ---');
		expect(section).toContain('--- run 2/2 ---');
		expect(section).toContain('[stderr]\nwarn');
	});

	it('neutralizes fence and details-tag injection from untrusted output', () => {
		const section = buildAgentDebugSection([
			{ stdout: '```\nevil\n```\n</details>', stderr: '' },
		]);
		// The wrapper's own outer </details> is the only legit one left.
		expect(section).not.toContain('```\nevil');
		expect(section?.split('</details>').length).toBe(2);
		expect(section).toContain('\\`\\`\\`');
		expect(section).toContain('&lt;/details&gt;');
	});

	it('truncates past the char cap and says where the rest lives', () => {
		const section = buildAgentDebugSection([
			{ stdout: 'x'.repeat(AGENT_DEBUG_MAX_CHARS + 100), stderr: '' },
		]);
		expect(section).toContain('_(truncated)_');
		expect(section).toContain('full log in action logs');
	});
});
