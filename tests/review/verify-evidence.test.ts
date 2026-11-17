import { describe, expect, it } from 'vitest';
import {
	applyVerifyPass,
	buildVerifyPrompt,
	runVerifyPass,
} from '../../src/review/verify.js';
import type { ChangedFile } from '../../src/types/context.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';

const finding: Finding = {
	severity: 'critical',
	confidence: 0.95,
	category: 'correctness',
	path: 'a.ts',
	line: 10,
	title: 'Unchecked input',
	description: 'Input may be null.',
	impact: 'The request fails.',
};
const changedFiles: ChangedFile[] = [
	{
		filename: 'a.ts',
		status: 'modified',
		additions: 1,
		deletions: 1,
		changes: 2,
		patch: '@@ -10 +10 @@\n-return input.value;\n+return input?.value;',
	},
];
const context = {
	title: 'Guard input',
	body: '',
	filenames: ['a.ts'],
	changedFiles,
	baseSha: 'base123',
	headSha: 'head456',
};
const answer = (verdict: string, evidenceIds: string[] = ['e1']) =>
	JSON.stringify({
		verdicts: [
			{
				id: 'c1',
				verdict,
				reason: 'The changed source guards null input.',
				evidenceIds,
			},
		],
	});
const run = (raw: string, source = context) =>
	runVerifyPass({
		findings: [finding],
		toolFindings: [],
		context: source,
		verify: async () => raw,
		inputTokenEstimate: 1000,
		outputTokenBudget: 1024,
	});

describe('source-backed independent verification', () => {
	it('drops only an explicit refutation backed by supplied source evidence', async () => {
		const result = await run(answer('refuted'));
		expect(result.findings).toEqual([]);
		expect(result.verificationStatus).toBe('complete');
	});
	it('retains a legacy boolean rejection without source evidence', async () => {
		const result = await run(
			'{"verdicts":[{"id":"c1","verified":false,"reason":"looks wrong"}]}'
		);
		expect(result.findings).toEqual([finding]);
		expect(result.verificationStatus).toBe('incomplete');
	});
	it.each(['uncertain', 'error'])(
		'retains the full original result and records %s',
		async (verdict) => {
			const result: ReviewResult = {
				findings: [finding],
				counts: { critical: 1, high: 0, medium: 0, low: 0 },
				risk: 'critical',
				summary: '',
				filesReviewed: ['a.ts'],
				reviewStatus: 'complete',
			};
			const original = result.findings;
			await applyVerifyPass(result, {
				...context,
				toolFindings: [],
				verify: async () => answer(verdict, []),
			});
			expect(result.findings).toBe(original);
			expect(result.risk).toBe('critical');
			expect(result.counts.critical).toBe(1);
			expect(result.reviewStatus).toBe('incomplete');
			expect(result.diagnostics?.verifyVerdicts).toEqual([
				expect.objectContaining({ id: 'c1', verdict }),
			]);
		}
	);
	it('retains candidates when the referenced source was never supplied', async () => {
		const result = await run(answer('refuted', ['invented']));
		expect(result.findings).toEqual([finding]);
		expect(result.verificationStatus).toBe('incomplete');
	});
	it('does not use an earlier complete answer after a malformed final envelope', async () => {
		const result = await run(
			'{"verdicts":[{"id":"c1","verified":false}]}\n{"verdicts":"interrupted"}'
		);
		expect(result.findings).toEqual([finding]);
		expect(result.verificationStatus).toBe('incomplete');
	});
	it('supplies before/after source and revision identity, not self-assessment alone', () => {
		const prompt = buildVerifyPrompt([finding], [], context);
		expect(prompt).toContain('return input?.value;');
		expect(prompt).toContain('return input.value;');
		expect(prompt).toContain('head456');
		expect(prompt).toContain('base123');
		expect(prompt).toContain('independent');
		expect(prompt).not.toContain('your OWN');
	});
	it('keeps every candidate when one verdict is missing despite another valid refutation', async () => {
		const findings = [finding, { ...finding, title: 'Another candidate' }];
		const result = await runVerifyPass({
			findings,
			toolFindings: [],
			context,
			verify: async () => answer('refuted'),
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.findings).toBe(findings);
		expect(result.verificationStatus).toBe('incomplete');
	});
});

describe('verification failure boundaries', () => {
	it('retains every candidate after an interrupted final JSON answer', async () => {
		const result = await run(`${answer('refuted')}\n{"verdicts":[`);
		expect(result.findings).toEqual([finding]);
		expect(result.verificationStatus).not.toBe('complete');
	});
	it('retains every candidate after an invalid final verdict object', async () => {
		const result = await run(`${answer('refuted')}\n{"verdicts": invalid}`);
		expect(result.findings).toEqual([finding]);
		expect(result.verificationStatus).not.toBe('complete');
	});
	it('does not accept evidence ids from a patch omitted by the context budget', async () => {
		const result = await run(answer('refuted'), {
			...context,
			changedFiles: [
				{
					...changedFiles[0],
					patch: `@@ -10 +10 @@\n-${'x'.repeat(30_000)}\n+new`,
				},
			],
		});
		expect(result.findings).toEqual([finding]);
		expect(result.verificationStatus).toBe('incomplete');
	});
	it('does not discard file names after the first twenty', () => {
		const paths = [
			...Array.from({ length: 25 }, (_, i) => `file-${i}.ts`),
			'a.ts',
		];
		expect(
			buildVerifyPrompt([finding], [], { ...context, filenames: paths })
		).toContain('file-24.ts');
	});
});
