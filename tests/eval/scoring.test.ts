import { describe, expect, it } from 'vitest';
import {
	PROPOSED_TARGETS,
	type ScoredCase,
	formatScoreTable,
	labelByAnchor,
	parseScoredCases,
	scoreCases,
	wilson95,
} from './scoring.js';

const tp = (severity: 'high' | 'low' = 'high') => ({
	label: 'tp' as const,
	severity,
});
const fp = (severity: 'high' | 'medium' | 'low' = 'high') => ({
	label: 'fp' as const,
	severity,
});

describe('scoreCases', () => {
	const cases: ScoredCase[] = [
		{ id: 'a', cleanPr: false, findings: [tp(), fp('medium')], missed: 1 },
		{ id: 'b', cleanPr: true, findings: [fp('high')], missed: 0 },
		{ id: 'c', cleanPr: true, findings: [fp('low')], missed: 0 },
		{ id: 'd', cleanPr: true, findings: [], missed: 0 },
		{ id: 'e', cleanPr: false, findings: [tp()], missed: 0 },
	];

	it('computes precision, recall, severe precision, and false-block rate', () => {
		const s = scoreCases(cases);
		expect(s.truePositives).toBe(2);
		expect(s.falsePositives).toBe(3);
		expect(s.missed).toBe(1);
		expect(s.precision.value).toBeCloseTo(2 / 5, 12);
		expect(s.recall.value).toBeCloseTo(2 / 3, 12);
		// high/critical only: tp, tp, fp(high) -> 2 of 3
		expect(s.severePrecision.value).toBeCloseTo(2 / 3, 12);
		// clean cases b, c, d; only b publishes something above low.
		expect(s.cleanCases).toBe(3);
		expect(s.falseBlocks).toBe(1);
		expect(s.falseBlockRate.value).toBeCloseTo(1 / 3, 12);
	});

	it('reports undefined metrics as null rather than 0 or 1', () => {
		const s = scoreCases([
			{ id: 'x', cleanPr: false, findings: [], missed: 0 },
		]);
		expect(s.precision.value).toBeNull();
		expect(s.recall.value).toBeNull();
		expect(s.falseBlockRate.value).toBeNull();
		expect(s.precision.interval).toBeNull();
	});

	it('counts a miss with no findings as zero recall', () => {
		const s = scoreCases([
			{ id: 'x', cleanPr: false, findings: [], missed: 2 },
		]);
		expect(s.recall.value).toBe(0);
	});

	it('honours an explicit blocked override', () => {
		const s = scoreCases([
			{
				id: 'x',
				cleanPr: true,
				findings: [fp('low')],
				missed: 0,
				blocked: true,
			},
			{
				id: 'y',
				cleanPr: true,
				findings: [fp('high')],
				missed: 0,
				blocked: false,
			},
		]);
		expect(s.falseBlocks).toBe(1);
	});

	it('handles an empty set', () => {
		const s = scoreCases([]);
		expect(s.cases).toBe(0);
		expect(s.precision.value).toBeNull();
	});
});

describe('wilson95', () => {
	it('matches reference values', () => {
		const i = wilson95(8, 10);
		expect(i?.low).toBeCloseTo(0.4902, 3);
		expect(i?.high).toBeCloseTo(0.9433, 3);
	});

	it('stays inside [0, 1] at the extremes', () => {
		expect(wilson95(0, 20)?.low).toBe(0);
		expect(wilson95(20, 20)?.high).toBe(1);
		expect(wilson95(0, 20)?.high).toBeCloseTo(0.161, 3);
	});

	it('is undefined without trials', () => {
		expect(wilson95(0, 0)).toBeNull();
	});
});

describe('labelByAnchor', () => {
	it('labels by exact anchor and counts unmatched seeded defects as missed', () => {
		const out = labelByAnchor(
			[
				{ path: 'a.ts', line: 2, severity: 'high' },
				{ path: 'a.ts', line: 9, severity: 'low' },
			],
			[
				{ path: 'a.ts', line: 2 },
				{ path: 'b.ts', line: 1 },
			]
		);
		expect(out.findings.map((f) => f.label)).toEqual(['tp', 'fp']);
		expect(out.missed).toBe(1);
	});

	it('does not double count two findings on one seeded anchor as found twice', () => {
		const out = labelByAnchor(
			[
				{ path: 'a.ts', line: 2, severity: 'high' },
				{ path: 'a.ts', line: 2, severity: 'high' },
			],
			[{ path: 'a.ts', line: 2 }]
		);
		expect(out.missed).toBe(0);
	});
});

describe('parseScoredCases', () => {
	it('accepts adjudicated JSON', () => {
		const parsed = parseScoredCases({
			cases: [
				{
					id: 'p1',
					cleanPr: true,
					findings: [{ label: 'fp', severity: 'high' }],
				},
			],
		});
		expect(parsed[0].missed).toBe(0);
		expect(scoreCases(parsed).falseBlocks).toBe(1);
	});

	it.each([
		[{}, /cases/],
		[{ cases: [{ id: '', cleanPr: true, findings: [] }] }, /id/],
		[{ cases: [{ id: 'a', cleanPr: 'yes', findings: [] }] }, /cleanPr/],
		[
			{
				cases: [
					{
						id: 'a',
						cleanPr: true,
						findings: [{ label: 'x', severity: 'low' }],
					},
				],
			},
			/label/,
		],
		[
			{
				cases: [
					{
						id: 'a',
						cleanPr: true,
						findings: [{ label: 'tp', severity: 'bad' }],
					},
				],
			},
			/severity/,
		],
		[
			{ cases: [{ id: 'a', cleanPr: true, findings: [], missed: -1 }] },
			/missed/,
		],
	])('rejects malformed input %#', (input, message) => {
		expect(() => parseScoredCases(input)).toThrow(message);
	});
});

describe('formatScoreTable', () => {
	it('prints a table that labels the targets as proposed', () => {
		const table = formatScoreTable(
			scoreCases([
				{ id: 'a', cleanPr: true, findings: [fp('high')], missed: 0 },
			])
		);
		expect(table).toContain('False-block rate');
		expect(table).toContain('100.0%');
		expect(table).toContain('proposed');
		expect(table).toContain('not measured results');
		expect(table).toContain(
			`>= ${(PROPOSED_TARGETS.recall.min * 100).toFixed(1)}%`
		);
	});

	it('prints n/a for undefined metrics', () => {
		expect(formatScoreTable(scoreCases([]))).toContain('n/a');
	});
});
