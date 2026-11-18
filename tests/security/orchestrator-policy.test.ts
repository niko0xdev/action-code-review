import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	SecurityContext,
	SecurityFinding,
	SecurityOptions,
} from '../../src/security/types.js';

const engine = vi.hoisted(() => ({
	findings: [] as unknown[],
	confirmFails: false,
	disposeFails: false,
	confirmIds: undefined as string[] | undefined,
	confirmed: [] as unknown[],
	confirmOutput: undefined as unknown[] | undefined,
	refutations: [] as unknown[],
}));

vi.mock('../../src/security/engines/pi-security-engine.js', () => ({
	PiSecurityEngine: class {
		async dispose() {
			if (engine.disposeFails) throw new Error('Synthetic cleanup failure');
		}
		get rejectedConfirmations() {
			return engine.refutations;
		}
		async diff() {
			return engine.findings;
		}
		async confirm(_ctx: unknown, findings: unknown[]) {
			if (engine.confirmFails) throw new Error('confirm exploded');
			engine.confirmed = findings;
			if (engine.confirmOutput) return engine.confirmOutput;
			return engine.confirmIds
				? findings.filter((f) =>
						engine.confirmIds?.includes((f as { id: string }).id)
					)
				: findings;
		}
	},
}));
vi.mock('../../src/security/scanners/scanner-engine.js', () => ({
	runSecurityScanners: async () => ({ findings: [], executions: [] }),
}));

const { runSecurityWorkflow } = await import(
	'../../src/security/orchestrator.js'
);

function finding(
	id: string,
	severity: SecurityFinding['severity']
): SecurityFinding {
	return {
		id,
		fingerprint: `fp-${id}`,
		title: `Finding ${id}`,
		severity,
		confidence: 'high',
		status: 'candidate',
		file: 'src/auth/token.ts',
		startLine: 1,
		evidence: [{ type: 'code', description: 'evidence' }],
		exploitability: 'likely',
	};
}

function run(overrides: Partial<SecurityOptions>, outputDir?: string) {
	const options: SecurityOptions = {
		mode: 'security',
		profile: 'diff',
		minSeverity: 'medium',
		failOn: 'critical',
		confirmFindings: true,
		inlineComments: true,
		stickyComment: true,
		generateSarif: false,
		maxFindings: 10,
		riskThreshold: 'high',
		outputDir,
		...overrides,
	};
	const context: SecurityContext = {
		repositoryPath: process.cwd(),
		owner: 'o',
		repo: 'r',
		prNumber: 1,
		changedFiles: [
			{
				filename: 'src/auth/token.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
			},
		],
		options,
	};
	return runSecurityWorkflow(context, options);
}

afterEach(() => {
	engine.findings = [];
	engine.confirmFails = false;
	engine.disposeFails = false;
	engine.confirmIds = undefined;
	engine.confirmed = [];
	engine.confirmOutput = undefined;
	engine.refutations = [];
});

describe('security orchestrator policy', () => {
	it('marks the review incomplete when the confirm pass fails', async () => {
		engine.findings = [finding('a', 'high')];
		engine.confirmFails = true;
		const result = await run({});
		expect(result.conclusion.incomplete).toBe(true);
		expect(result.summaryMarkdown).toMatch(/incomplete/i);
	});

	it('preserves the completed assessment when runtime cleanup fails', async () => {
		engine.findings = [finding('a', 'high')];
		engine.disposeFails = true;
		const result = await run({ confirmFindings: false });
		expect(result.findings).toMatchObject([{ id: 'a', severity: 'high' }]);
		expect(result.conclusion.incomplete).toBe(false);
		expect(result.conclusion.engineStatus).toBe('success');
	});

	it('clears sarifPath when the SARIF write fails', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'sarif-'));
		try {
			const outputDir = join(dir, 'ro');
			await mkdir(outputDir);
			await chmod(outputDir, 0o500);
			const result = await run({ generateSarif: true }, outputDir);
			if (process.getuid?.() === 0) return; // root ignores permissions
			expect(result.sarifPath).toBeUndefined();
		} finally {
			await chmod(join(dir, 'ro'), 0o700).catch(() => {});
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('triggers fail-on below min-severity', async () => {
		engine.findings = [finding('a', 'low')];
		const result = await run({ minSeverity: 'high', failOn: 'low' });
		expect(result.findings).toHaveLength(0);
		expect(result.conclusion.failThresholdReached).toBe(true);
	});
});

describe('full validated security policy', () => {
	it('applies fail-on independently of a zero publication cap', async () => {
		engine.findings = [finding('a', 'high')];
		const result = await run({ maxFindings: 0, failOn: 'high' });
		expect(result.findings).toEqual([]);
		expect(result.conclusion.failThresholdReached).toBe(true);
		expect(result.conclusion.validatedFindings).toBe(1);
		expect(result.conclusion.publishedFindings).toBe(0);
		expect(result.conclusion.risk).toBe('high');
	});

	it('confirms high candidates even when publication and fail-on thresholds hide them', async () => {
		engine.findings = [finding('a', 'high')];
		engine.confirmFails = true;
		const result = await run({
			minSeverity: 'critical',
			failOn: 'none',
			maxFindings: 0,
		});
		expect(result.conclusion.incomplete).toBe(true);
		expect(result.conclusion.validatedFindings).toBe(1);
		expect(result.conclusion.failThresholdReached).toBe(false);
	});

	it.each([undefined, '', 'Use a verified replacement.'])(
		'preserves existing remediation unless confirmation supplies an improvement: %j',
		async (remediation) => {
			const original = {
				...finding('a', 'high'),
				remediation: 'Keep the existing remediation.',
			};
			engine.findings = [original];
			engine.confirmOutput = [{ ...original, remediation }];
			const result = await run({});
			expect(result.conclusion.incomplete).toBe(false);
			expect(result.findings[0].remediation).toBe(
				remediation || original.remediation
			);
		}
	);

	it('fills the publication cap after explicit confirmation refutes the first candidate', async () => {
		engine.findings = [finding('a', 'critical'), finding('b', 'high')];
		engine.confirmIds = ['b'];
		engine.refutations = [
			{
				...finding('a', 'critical'),
				status: 'rejected',
				evidence: [
					{ type: 'reasoning', description: 'The source is constant' },
				],
			},
		];
		const result = await run({ maxFindings: 1, failOn: 'high' });
		expect(result.findings.map((f) => f.id)).toEqual(['b']);
		expect(result.conclusion.failThresholdReached).toBe(true);
		expect(result.conclusion.validatedFindings).toBe(1);
	});

	it('retains high candidates and failure policy if confirmation returns an unknown candidate', async () => {
		engine.findings = [finding('a', 'high')];
		const options = { minSeverity: 'critical', failOn: 'high' } as const;
		engine.confirmOutput = [finding('unknown', 'high')];
		const result = await run(options);
		expect(result.conclusion.incomplete).toBe(true);
		expect(result.conclusion.failThresholdReached).toBe(true);
		expect(result.conclusion.validatedFindings).toBe(1);
	});
});

describe('confirmation boundary validation', () => {
	it.each([
		{ confidence: 'unknown' },
		{ severity: 'low' },
		{ evidence: null },
		{ title: 'A different claim' },
		{ remediation: 42 },
		{ id: 'another-id' },
	])(
		'retains candidates when confirmation returns malformed fields: %j',
		async (change) => {
			engine.findings = [finding('a', 'high')];
			engine.confirmOutput = [{ ...finding('a', 'high'), ...change }];
			const result = await run({ failOn: 'high' });
			expect(result.findings).toMatchObject([
				{
					id: 'a',
					severity: 'high',
					confidence: 'high',
					evidence: [{ type: 'code', description: 'evidence' }],
				},
			]);
			expect(result.conclusion).toMatchObject({
				incomplete: true,
				failThresholdReached: true,
			});
		}
	);
});

describe('complete explicit confirmation partitions', () => {
	it.each([
		{ output: [], refuted: [] },
		{ output: [], refuted: ['unknown'] },
		{ output: [], refuted: ['a', 'a'] },
		{ output: ['a'], refuted: ['a'] },
		{ output: [], refuted: ['a'], evidence: [] },
		{
			output: [],
			refuted: ['a'],
			evidence: [{ type: 'reasoning', description: '   ' }],
		},
	])(
		'keeps the whole candidate pool on an invalid partition: %j',
		async ({ output, refuted, evidence }) => {
			engine.findings = [finding('a', 'high')];
			engine.confirmOutput = output.map((id) => finding(id, 'high'));
			engine.refutations = refuted.map((id) => ({
				...finding(id, 'high'),
				status: 'rejected',
				evidence: evidence ?? [
					{ type: 'reasoning', description: 'The source is constant' },
				],
			}));
			const result = await run({ failOn: 'high' });
			expect(result.findings.map((f) => f.id)).toEqual(['a']);
			expect(result.rejectedFindings).toEqual([]);
			expect(result.conclusion).toMatchObject({
				incomplete: true,
				failThresholdReached: true,
			});
		}
	);

	it('retains all candidates when a confirmation batch only assesses the first occurrence', async () => {
		engine.findings = [
			finding('a', 'high'),
			{ ...finding('b', 'high'), fingerprint: 'fp-a', startLine: 100 },
		];
		engine.confirmOutput = [finding('a', 'high')];
		const result = await run({ failOn: 'high' });
		expect(result.findings.map((f) => f.startLine)).toEqual([1, 100]);
		expect(result.conclusion.incomplete).toBe(true);
	});
});
