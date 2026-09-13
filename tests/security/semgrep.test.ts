import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSecurityWorkflow } from '../../src/security/orchestrator.js';
import { runSemgrepScanner } from '../../src/security/scanners/semgrep.js';
import type {
	SecurityContext,
	SecurityOptions,
} from '../../src/security/types.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

vi.mock('../../src/security/engines/pi-security-engine.js', () => ({
	PiSecurityEngine: class {
		readonly name = 'fake-pi';
		diff = async () => [];
		audit = async () => [];
		confirm = async (_ctx: unknown, findings: never[]) => findings;
	},
}));

const mockSpawn = vi.mocked(spawn);

interface SpawnPlan {
	stdout?: string;
	code?: number | null;
	signal?: NodeJS.Signals | null;
	error?: NodeJS.ErrnoException;
}

function planSpawn(plan: SpawnPlan): void {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: () => boolean;
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = () => true;
	mockSpawn.mockReturnValueOnce(proc as unknown as ChildProcess);
	process.nextTick(() => {
		if (plan.error) {
			proc.emit('error', plan.error);
			return;
		}
		if (plan.stdout !== undefined) {
			proc.stdout.emit('data', Buffer.from(plan.stdout));
		}
		proc.emit('close', plan.code ?? 0, plan.signal ?? null);
	});
}

function semgrepFinding(checkId = 'python.lang.security.audit.test') {
	return {
		check_id: checkId,
		path: 'src/a.py',
		start: { line: 3, col: 1 },
		end: { line: 3, col: 10 },
		extra: { message: 'Possible issue', severity: 'ERROR', metadata: {} },
	};
}

function enoent(): NodeJS.ErrnoException {
	const err = new Error('spawn semgrep ENOENT') as NodeJS.ErrnoException;
	err.code = 'ENOENT';
	return err;
}

function eacces(): NodeJS.ErrnoException {
	const err = new Error('spawn semgrep EACCES') as NodeJS.ErrnoException;
	err.code = 'EACCES';
	return err;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('runSemgrepScanner completion truth', () => {
	it('reports success for a clean scan', async () => {
		planSpawn({ stdout: JSON.stringify({ results: [], errors: [] }) });
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('success');
		expect(res.findings).toHaveLength(0);
	});

	it('reports success with parsed findings', async () => {
		planSpawn({
			stdout: JSON.stringify({ results: [semgrepFinding()], errors: [] }),
		});
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('success');
		expect(res.findings).toHaveLength(1);
		expect(res.findings[0].severity).toBe('high');
	});

	it('reports failed on exit 2 with structured errors', async () => {
		planSpawn({
			stdout: JSON.stringify({ results: [], errors: [{ message: 'x' }] }),
			code: 2,
		});
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
	});

	it('preserves valid findings from a failed scan with errors', async () => {
		planSpawn({
			stdout: JSON.stringify({
				results: [semgrepFinding()],
				errors: [{ message: 'invalid rules' }],
			}),
			code: 2,
		});
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
		expect(res.findings).toHaveLength(1);
		expect(res.execution.findings).toBe(1);
	});

	it('reports failed on exit 0 with a missing results array', async () => {
		planSpawn({ stdout: JSON.stringify({}) });
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
		expect(res.findings).toHaveLength(0);
	});

	it('reports failed on malformed JSON output', async () => {
		planSpawn({ stdout: 'not json at all' });
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
		expect(res.findings).toHaveLength(0);
	});

	it('reports failed on a non-array results envelope', async () => {
		planSpawn({ stdout: JSON.stringify({ results: {}, errors: [] }) });
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
	});

	it('reports failed on nonzero exit 1 even with valid results', async () => {
		planSpawn({
			stdout: JSON.stringify({ results: [semgrepFinding()], errors: [] }),
			code: 1,
		});
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
		expect(res.findings).toHaveLength(1);
	});

	it('reports failed on signal termination', async () => {
		planSpawn({
			stdout: JSON.stringify({ results: [semgrepFinding()], errors: [] }),
			code: null,
			signal: 'SIGTERM',
		});
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
		expect(res.findings).toHaveLength(1);
	});

	it('skips malformed result records without throwing or reporting clean success falsely', async () => {
		planSpawn({
			stdout: JSON.stringify({
				results: [{}, null, 42, semgrepFinding(), { check_id: 7 }],
				errors: [],
			}),
		});
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('success');
		expect(res.findings).toHaveLength(1);
	});

	it('reports skipped when the binary is missing', async () => {
		planSpawn({ error: enoent() });
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('skipped');
	});

	it('reports failed on non-ENOENT launch failures', async () => {
		planSpawn({ error: eacces() });
		const res = await runSemgrepScanner('/repo', ['src/a.py']);
		expect(res.execution.status).toBe('failed');
	});

	it('reports skipped with no files without spawning', async () => {
		const res = await runSemgrepScanner('/repo', []);
		expect(res.execution.status).toBe('skipped');
		expect(mockSpawn).not.toHaveBeenCalled();
	});
});

describe('failed semgrep scan propagates incomplete workflow', () => {
	it('marks conclusion incomplete and warns in the summary', async () => {
		planSpawn({
			stdout: JSON.stringify({
				results: [semgrepFinding()],
				errors: [{ message: 'invalid rules' }],
			}),
			code: 2,
		});

		const options: SecurityOptions = {
			mode: 'security',
			profile: 'diff',
			minSeverity: 'medium',
			failOn: 'critical',
			confirmFindings: false,
			inlineComments: false,
			stickyComment: true,
			generateSarif: false,
			maxFindings: 10,
			riskThreshold: 'high',
		};
		const context: SecurityContext = {
			repositoryPath: process.cwd(),
			owner: 'test-org',
			repo: 'test-repo',
			prNumber: 7,
			changedFiles: [
				{
					filename: 'README.md',
					status: 'modified',
					additions: 1,
					deletions: 0,
					patch: '+# Updated Readme',
				},
				{
					filename: 'src/a.py',
					status: 'modified',
					additions: 1,
					deletions: 0,
				},
			],
			options,
		};

		const result = await runSecurityWorkflow(context, options);
		expect(result.conclusion.incomplete).toBe(true);
		expect(result.conclusion.scanners.some((s) => s.status === 'failed')).toBe(
			true
		);
		expect(result.summaryMarkdown).toContain('SECURITY REVIEW INCOMPLETE');
		expect(result.findings.length).toBeGreaterThanOrEqual(1);
	});
});
