import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AGENT_DEBUG_MAX_CHARS,
	DEFAULT_MAX_OUTPUT_BYTES,
	PI_READONLY_TOOLS,
	PiHarness,
	aggregatePiUsage,
	buildAgentDebugSection,
	buildPiArgs,
	buildPiEnv,
	countAssistantBytes,
	countToolCalls,
	extractAssistantResult,
	extractAssistantText,
	parsePiUsage,
	summarizeToolCalls,
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
	it('runs non-interactive text mode with a read-only toolset', () => {
		// Text mode prints only the final assistant message. JSON mode
		// re-serializes every streamed delta and measured 64 MiB of stdout for a
		// normal review, which killed healthy groups on the output cap.
		const args = buildPiArgs('/repo');
		expect(args).toContain('-p');
		expect(args).toContain('--mode');
		expect(args[args.indexOf('--mode') + 1]).toBe('text');
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
	it('parses the raw JSON that text mode prints', async () => {
		// Text mode writes only the final assistant message, so stdout is the
		// artifact itself rather than a JSON event stream.
		const bin = writeFakePi(
			`#!/bin/sh
cat <<'EOF'
{"findings":[{"severity":"medium","confidence":0.9,"category":"correctness","path":"src/a.ts","line":3,"title":"t","description":"d","impact":"i"}],"summary":"text mode","risk":"medium"}
EOF
`
		);
		const harness = new PiHarness({ binaryPath: bin });
		const result = await harness.review(makeContext());
		expect(result.summary).toBe('text mode');
		expect(result.findings).toHaveLength(1);
	});

	it('reports the provider error text mode writes to stderr', async () => {
		const bin = writeFakePi(
			'#!/bin/sh\necho "401 Incorrect API key provided" >&2\nexit 1\n'
		);
		const harness = new PiHarness({ binaryPath: bin });
		await expect(harness.review(makeContext())).rejects.toThrow(
			/401 Incorrect API key provided/
		);
	});

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

	it('kills a process when stdout exceeds the default cap', async () => {
		const bin = writeFakePi(
			`#!/bin/sh\nhead -c ${DEFAULT_MAX_OUTPUT_BYTES + 1} /dev/zero\n`
		);
		const harness = new PiHarness({ binaryPath: bin, timeoutMs: 20_000 });
		await expect(harness.review(makeContext())).rejects.toThrow(
			new RegExp(`stdout output exceeded ${DEFAULT_MAX_OUTPUT_BYTES} byte cap`)
		);
	});

	it('honors a caller-supplied output cap', async () => {
		const bin = writeFakePi('#!/bin/sh\nhead -c 4097 /dev/zero\n');
		const harness = new PiHarness({
			binaryPath: bin,
			timeoutMs: 10_000,
			maxOutputBytes: 4096,
		});
		await expect(harness.review(makeContext())).rejects.toThrow(
			/stdout output exceeded 4096 byte cap/
		);
	});

	it('kills a process when stderr exceeds the cap', async () => {
		const bin = writeFakePi('#!/bin/sh\nhead -c 9000000 /dev/zero >&2\n');
		const harness = new PiHarness({
			binaryPath: bin,
			timeoutMs: 20_000,
			maxOutputBytes: 4 * 1024 * 1024,
		});
		await expect(harness.review(makeContext())).rejects.toThrow(
			/stderr output exceeded 4194304 byte cap/
		);
	});

	it('stops a provider that streams a runaway answer', async () => {
		const bin = writeFakePi(
			'#!/bin/sh\nprintf \'{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"%s"}}\\n\' "$(head -c 4000 /dev/zero | tr \'\\0\' \'a\')"\nsleep 30\n'
		);
		const harness = new PiHarness({
			binaryPath: bin,
			timeoutMs: 20_000,
			maxAssistantBytes: 1024,
		});
		await expect(harness.review(makeContext())).rejects.toThrow(
			/model-output ceiling/
		);
	});

	it('stops a runaway tool loop at the tool-call ceiling', async () => {
		const events = Array.from(
			{ length: 80 },
			() => '{"type":"tool_execution_start","toolName":"read"}'
		).join('\n');
		const bin = writeFakePi(
			`#!/bin/sh\nprintf '%s\\n' '${events.replace(/'/g, '')}'\nsleep 30\n`
		);
		const harness = new PiHarness({
			binaryPath: bin,
			timeoutMs: 20_000,
			maxToolCalls: 10,
		});
		await expect(harness.review(makeContext())).rejects.toThrow(
			/tool-call ceiling/
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

describe('PiHarness repair retry', () => {
	function contextWithFile(): ReviewContext {
		const context = makeContext();
		return {
			...context,
			diff: {
				...context.diff,
				files: [
					{
						filename: 'src/a.ts',
						status: 'modified',
						additions: 1,
						deletions: 0,
						patch: '@@ -1 +1 @@\n-const a = 1;\n+const a = 2;',
					},
				],
			},
		};
	}

	function messageEnd(text: string): string {
		return `${JSON.stringify({
			type: 'message_end',
			message: { role: 'assistant', content: [{ type: 'text', text }] },
		})}\n`;
	}

	it('re-asks once when the model answers with prose instead of JSON', async () => {
		const prompts: string[] = [];
		const runner = vi.fn(async (params: { prompt: string }) => {
			prompts.push(params.prompt);
			if (prompts.length === 1)
				return {
					stdout: messageEnd(
						'OK, ready to write findings. Let me focus on the substantive issues:'
					),
					stderr: '',
				};
			return {
				stdout: messageEnd(
					JSON.stringify({
						findings: [],
						summary: 'clean after repair',
						risk: 'none',
					})
				),
				stderr: '',
			};
		});
		const harness = new PiHarness({ runPi: runner as never });
		const result = await harness.review(contextWithFile());
		expect(runner).toHaveBeenCalledTimes(2);
		expect(result.summary).toBe('clean after repair');
		expect(harness.runs).toHaveLength(2);
		// The repair prompt must carry the rejected answer so the model can
		// convert its own output instead of starting over.
		expect(prompts[1]).toContain('ready to write findings');
		expect(prompts[1]).toContain('Do not review the code again');
	});

	it('surfaces the parse error when every attempt is malformed', async () => {
		const runner = vi.fn(async () => ({
			stdout: messageEnd('still prose, no artifact here'),
			stderr: '',
		}));
		const harness = new PiHarness({ runPi: runner as never });
		await expect(harness.review(contextWithFile())).rejects.toThrow(
			/Unable to parse harness output as JSON/
		);
		expect(runner).toHaveBeenCalledTimes(2);
	});

	it('does not retry when a transport error already carries diagnostics', async () => {
		const runner = vi.fn(async () => {
			const error = new Error('Pi stdout output exceeded 8388608 byte cap');
			(error as unknown as Record<string, unknown>).piLog = {
				stdout: '',
				stderr: 'runaway',
			};
			throw error;
		});
		const harness = new PiHarness({ runPi: runner as never });
		await expect(harness.review(contextWithFile())).rejects.toThrow(/byte cap/);
		expect(runner).toHaveBeenCalledTimes(1);
		expect(harness.runs).toHaveLength(1);
	});
});

describe('countToolCalls', () => {
	it('counts tool executions in a JSON event stream', () => {
		const stream = [
			'{"type":"session"}',
			'{"type":"tool_execution_start","toolName":"read"}',
			'{"type":"tool_execution_end","toolName":"read"}',
			'{"type":"tool_execution_start","toolName":"grep"}',
			'not json at all',
		].join('\n');
		expect(countToolCalls(stream)).toBe(2);
	});
});

describe('countAssistantBytes', () => {
	it('counts streamed assistant text deltas only', () => {
		const stream = [
			JSON.stringify({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', delta: 'abcde' },
			}),
			JSON.stringify({
				type: 'message_update',
				assistantMessageEvent: {
					type: 'thinking_delta',
					delta: 'x'.repeat(99),
				},
			}),
			JSON.stringify({
				type: 'message_end',
				message: { role: 'assistant', content: [] },
			}),
		].join('\n');
		expect(countAssistantBytes(stream)).toBe(5);
	});
});

describe('summarizeToolCalls', () => {
	it('reports per-tool counts and result volume', () => {
		const stream = [
			JSON.stringify({
				type: 'tool_execution_end',
				toolName: 'read',
				result: 'x'.repeat(2048),
			}),
			JSON.stringify({
				type: 'tool_execution_end',
				toolName: 'read',
				result: 'y'.repeat(1024),
			}),
			JSON.stringify({
				type: 'tool_execution_end',
				toolName: 'grep',
				result: 'z'.repeat(10),
			}),
			'not json',
		].join('\n');
		const summary = summarizeToolCalls(stream);
		expect(summary).toContain('read\u00d72 (~3 KiB of results)');
		expect(summary).toContain('grep\u00d71');
	});

	it('says so when nothing was called', () => {
		expect(summarizeToolCalls('{"type":"agent_end"}')).toBe('no tool calls');
	});
});

describe('assistant failures reported by Pi', () => {
	function messageEnd(message: Record<string, unknown>): string {
		return `${JSON.stringify({ type: 'message_end', message })}\n`;
	}

	it('surfaces the upstream error instead of an empty parse failure', async () => {
		// Shape observed in production: the provider call failed, Pi emits an
		// assistant message_end with stopReason "error", an errorMessage and an
		// empty content array. It used to become "output started with: ".
		const stdout = messageEnd({
			role: 'assistant',
			content: [],
			stopReason: 'error',
			errorMessage: '401 Invalid or expired API key',
		});
		expect(extractAssistantResult(stdout).error).toBe(
			'401 Invalid or expired API key'
		);
		const runner = vi.fn(async () => ({ stdout, stderr: '' }));
		const harness = new PiHarness({ runPi: runner as never });
		await expect(harness.review(makeContext())).rejects.toThrow(
			/Pi harness reported an error instead of a review result: 401 Invalid or expired API key/
		);
		// A transport failure is not a malformed answer: no repair retry.
		expect(runner).toHaveBeenCalledTimes(1);
	});

	it('keeps a usable answer even when a later message reports an error', () => {
		const stdout = [
			messageEnd({
				role: 'assistant',
				content: [{ type: 'text', text: '{"findings":[],"summary":"ok"}' }],
				stopReason: 'stop',
			}),
			messageEnd({
				role: 'assistant',
				content: [],
				stopReason: 'error',
				errorMessage: 'context window exceeded',
			}),
		].join('');
		const assistant = extractAssistantResult(stdout);
		expect(assistant.text).toContain('"summary":"ok"');
		expect(assistant.error).toBe('context window exceeded');
	});

	it('describes a length stop reason without an errorMessage', () => {
		const stdout = messageEnd({
			role: 'assistant',
			content: [{ type: 'text', text: '{"findings":' }],
			stopReason: 'length',
		});
		expect(extractAssistantResult(stdout).error).toContain(
			'cut off by the output-token limit'
		);
	});
});

describe('empty harness output', () => {
	function messageEnd(message: Record<string, unknown>): string {
		return `${JSON.stringify({ type: 'message_end', message })}\n`;
	}

	it('reports an empty answer as a model/gateway problem', async () => {
		// Pi exits 0 with no errorMessage and an empty content array when a
		// gateway answers a streaming request with a non-streaming body.
		// Without this guard the group fails with the misleading parse error.
		const stdout = messageEnd({
			role: 'assistant',
			content: [],
			stopReason: 'stop',
		});
		const runner = vi.fn(async () => ({ stdout, stderr: '' }));
		const harness = new PiHarness({ runPi: runner as never });
		await expect(harness.review(makeContext())).rejects.toThrow(
			/the model returned an empty assistant message/
		);
	});

	it('treats whitespace-only output as empty', async () => {
		const stdout = messageEnd({
			role: 'assistant',
			content: [{ type: 'text', text: '   \n  ' }],
			stopReason: 'stop',
		});
		const runner = vi.fn(async () => ({ stdout, stderr: '' }));
		const harness = new PiHarness({ runPi: runner as never });
		await expect(harness.review(makeContext())).rejects.toThrow(
			/the model returned an empty assistant message/
		);
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
