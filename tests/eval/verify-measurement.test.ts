import { describe, expect, it } from 'vitest';
import { applyVerifyPass, runVerifyPass } from '../../src/review/verify.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';
import {
	type EvalSeverity,
	type ScoredCase,
	formatScoreTable,
	isBlocking,
	scoreCases,
} from './scoring.js';

/**
 * Measures the verify pass with a scripted verifier that answers in the
 * protocol the real prompt documents (one verdict per candidate id). The numbers describe this
 * canned data, not any model: the verdicts are written by hand, so they only
 * prove that the pipeline removes what the verifier rejects and keeps the rest.
 * To measure a real model, adjudicate its output and feed it to the scorer (see
 * docs/evaluation.md).
 */

interface Labelled {
	id: string;
	label: 'tp' | 'fp';
	severity: EvalSeverity;
	/** What the scripted verifier says about it. */
	approve: boolean;
}

interface Case {
	id: string;
	cleanPr: boolean;
	/** Seeded defects the main pass did not publish at all. */
	missed: number;
	findings: Labelled[];
}

const CASES: Case[] = [
	{
		id: 'seeded-null-deref',
		cleanPr: false,
		missed: 0,
		findings: [
			{ id: 'null-deref', label: 'tp', severity: 'high', approve: true },
			{ id: 'phantom-race', label: 'fp', severity: 'high', approve: false },
		],
	},
	{
		id: 'seeded-sql-injection',
		cleanPr: false,
		missed: 1,
		findings: [
			{ id: 'sqli', label: 'tp', severity: 'critical', approve: true },
			{ id: 'style-nit', label: 'fp', severity: 'medium', approve: false },
		],
	},
	{
		id: 'clean-refactor',
		cleanPr: true,
		missed: 0,
		findings: [
			{ id: 'wrong-claim', label: 'fp', severity: 'high', approve: false },
			{ id: 'speculative', label: 'fp', severity: 'critical', approve: false },
		],
	},
	{
		id: 'clean-rename',
		cleanPr: true,
		missed: 0,
		// The verifier wrongly approves this false positive: a real limitation.
		findings: [
			{ id: 'plausible-fp', label: 'fp', severity: 'high', approve: true },
		],
	},
];

function toFinding(l: Labelled): Finding {
	return {
		severity: l.severity,
		confidence: 0.9,
		category: 'correctness',
		path: 'src/app.ts',
		line: 10,
		title: `Finding ${l.id}`,
		description: 'd',
		impact: 'i',
	};
}

function resultOf(c: Case): ReviewResult {
	const findings = c.findings.map(toFinding);
	return {
		findings,
		summary: '',
		risk: 'high',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: ['src/app.ts'],
		reviewStatus: 'complete',
	};
}

/**
 * Scripted provider that follows the prompt's own protocol: it reads the
 * candidates (each with an `id`) from the prompt actually sent and answers
 * with exactly one verdict per id, `verified` true or false, never omitting.
 */
function scripted(c: Case, calls: string[]) {
	return async (prompt: string) => {
		calls.push(prompt);
		const block = /```json\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? '[]';
		const candidates = JSON.parse(block) as Array<{
			id: string;
			title: string;
		}>;
		const verdicts = candidates.map((cand) => {
			const l = c.findings.find((x) => `Finding ${x.id}` === cand.title);
			return { id: cand.id, verified: l?.approve ?? true, reason: 'scripted' };
		});
		return JSON.stringify({ verdicts });
	};
}

function scoreOf(
	cases: Case[],
	published: (c: Case) => Labelled[],
	missedExtra: (c: Case) => number
): ScoredCase[] {
	return cases.map((c) => ({
		id: c.id,
		cleanPr: c.cleanPr,
		findings: published(c).map((l) => ({
			label: l.label,
			severity: l.severity,
		})),
		missed: c.missed + missedExtra(c),
	}));
}

async function verified(c: Case, minSeverity?: 'medium') {
	const result = resultOf(c);
	const calls: string[] = [];
	await applyVerifyPass(result, {
		toolFindings: [],
		title: 't',
		body: '',
		verify: scripted(c, calls),
		...(minSeverity ? { minSeverity } : {}),
	});
	return { result, calls };
}

describe('verify pass measurement on canned data', () => {
	it('removes rejected findings, keeps approved ones, and moves the scores', async () => {
		const before = scoreCases(
			scoreOf(
				CASES,
				(c) => c.findings,
				() => 0
			)
		);
		const keptByCase = new Map<string, Set<string>>();
		for (const c of CASES) {
			const { result } = await verified(c);
			const titles = new Set(result.findings.map((f) => f.title));
			keptByCase.set(c.id, titles);
			for (const l of c.findings) {
				const isTarget = l.severity === 'high' || l.severity === 'critical';
				const expectKept = !isTarget || l.approve;
				expect(titles.has(`Finding ${l.id}`)).toBe(expectKept);
			}
			if (c.findings.some((l) => l.approve && l.severity !== 'medium')) {
				expect(result.diagnostics?.verifyVerified).toBeGreaterThan(0);
			}
			expect(result.reviewStatus).toBe('complete');
		}
		const published = (c: Case) =>
			c.findings.filter((l) => keptByCase.get(c.id)?.has(`Finding ${l.id}`));
		// A rejected true positive would become a miss; none is rejected here.
		const after = scoreCases(
			scoreOf(
				CASES,
				published,
				(c) =>
					c.findings.filter(
						(l) => l.label === 'tp' && !published(c).includes(l)
					).length
			)
		);
		if (process.env.EVAL_VERBOSE) {
			console.log(`Before verify (canned data)\n${formatScoreTable(before)}`);
			console.log(`After verify (canned data)\n${formatScoreTable(after)}`);
		}
		expect(before.falsePositives).toBe(5);
		expect(after.falsePositives).toBe(2);
		expect(after.truePositives).toBe(before.truePositives);
		expect(after.recall.value).toBe(before.recall.value);
		expect(after.precision.value as number).toBeGreaterThan(
			before.precision.value as number
		);
		expect(after.falseBlocks).toBe(1);
		expect(before.falseBlocks).toBe(2);
		expect(after.falseBlocks).toBeLessThan(before.falseBlocks);
	});

	it('leaves medium findings untouched at the default severity', async () => {
		const c = CASES[1];
		const { result, calls } = await verified(c);
		expect(calls[0]).not.toContain('Finding style-nit');
		expect(result.findings.map((f) => f.title)).toContain('Finding style-nit');
	});

	it('removes a rejected medium finding only when the floor is medium', async () => {
		const c = CASES[1];
		const { result } = await verified(c, 'medium');
		expect(result.findings.map((f) => f.title)).not.toContain(
			'Finding style-nit'
		);
		expect(result.findings.some(isBlocking)).toBe(true);
	});

	it('skips the call when no high or critical finding exists', async () => {
		const c: Case = {
			id: 'only-medium',
			cleanPr: true,
			missed: 0,
			findings: [{ id: 'm', label: 'fp', severity: 'medium', approve: false }],
		};
		const { result, calls } = await verified(c);
		expect(calls).toHaveLength(0);
		expect(result.findings).toHaveLength(1);
		expect(result.diagnostics?.verifyStatus).toBe('skipped');
		expect(result.reviewStatus).toBe('complete');
	});

	it('keeps everything and marks the review incomplete when the verifier errors', async () => {
		for (const c of CASES) {
			const result = resultOf(c);
			await applyVerifyPass(result, {
				toolFindings: [],
				title: 't',
				body: '',
				verify: async () => {
					throw new Error('provider down');
				},
			});
			expect(result.findings).toHaveLength(c.findings.length);
			expect(result.reviewStatus).toBe('incomplete');
		}
	});

	it('does not call the verifier when the estimated cost exceeds the budget', async () => {
		const c = CASES[0];
		const calls: string[] = [];
		const out = await runVerifyPass({
			findings: resultOf(c).findings,
			toolFindings: [],
			context: { title: 't', body: '', filenames: ['src/app.ts'] },
			verify: scripted(c, calls),
			inputTokenEstimate: 10,
			outputTokenBudget: 10,
			budgetUsd: 0,
		});
		expect(calls).toHaveLength(0);
		expect(out.skipped).toBe(true);
		expect(out.findings).toHaveLength(c.findings.length);
	});
});
