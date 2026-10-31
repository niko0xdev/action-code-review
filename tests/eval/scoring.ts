/**
 * Review-quality scoring. Dependency-free and deterministic: feed it labelled
 * outcomes (from the stubbed provider here, or from real model output later)
 * and it computes precision, recall, and the false-block rate.
 *
 * Definitions
 * - A published finding is a true positive (`tp`) when it matches a seeded or
 *   adjudicated defect, otherwise a false positive (`fp`).
 * - A seeded defect with no matching published finding is `missed`.
 * - A case is "blocked" when it publishes at least one finding above `low`
 *   (the publisher requests changes for those). A blocked case whose PR is
 *   genuinely clean is a false block.
 */

export type EvalSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface LabelledFinding {
	label: 'tp' | 'fp';
	severity: EvalSeverity;
}

export interface ScoredCase {
	id: string;
	/** True when the PR is known to contain no defect. */
	cleanPr: boolean;
	/** Findings that were published for this case, each labelled. */
	findings: LabelledFinding[];
	/** Seeded or adjudicated defects the review did not publish. */
	missed: number;
	/** Override when the blocking decision is not "any finding above low". */
	blocked?: boolean;
}

export interface Interval {
	low: number;
	high: number;
}

export interface Metric {
	/** Null when the denominator is zero (the metric is undefined, not 0). */
	value: number | null;
	numerator: number;
	denominator: number;
	/** 95% Wilson score interval, null when the denominator is zero. */
	interval: Interval | null;
}

export interface ScoreSummary {
	cases: number;
	truePositives: number;
	falsePositives: number;
	missed: number;
	cleanCases: number;
	falseBlocks: number;
	precision: Metric;
	recall: Metric;
	severePrecision: Metric;
	falseBlockRate: Metric;
}

/**
 * Proposed release gates from docs/research/improvement-roadmap.md section 2.
 * They are proposals to freeze before benchmarking, not measured results.
 */
export const PROPOSED_TARGETS = {
	severePrecision: { min: 0.98, minLowerBound: 0.95, minSamples: 300 },
	recall: { min: 0.8 },
	falseBlockRate: { max: 0.01, maxUpperBound: 0.02, minSamples: 200 },
} as const;

export function isBlocking(finding: { severity: EvalSeverity }): boolean {
	return finding.severity !== 'low';
}

/** 95% Wilson score interval for `k` successes in `n` trials. */
export function wilson95(k: number, n: number): Interval | null {
	if (n <= 0) return null;
	const z = 1.959963984540054;
	const p = k / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denominator;
	const margin =
		(z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
	return {
		low: Math.max(0, centre - margin),
		high: Math.min(1, centre + margin),
	};
}

function metric(numerator: number, denominator: number): Metric {
	return {
		value: denominator > 0 ? numerator / denominator : null,
		numerator,
		denominator,
		interval: wilson95(numerator, denominator),
	};
}

export function scoreCases(cases: readonly ScoredCase[]): ScoreSummary {
	let tp = 0;
	let fp = 0;
	let missed = 0;
	let severeTp = 0;
	let severeFp = 0;
	let cleanCases = 0;
	let falseBlocks = 0;
	for (const c of cases) {
		missed += c.missed;
		for (const finding of c.findings) {
			const severe =
				finding.severity === 'critical' || finding.severity === 'high';
			if (finding.label === 'tp') {
				tp += 1;
				if (severe) severeTp += 1;
			} else {
				fp += 1;
				if (severe) severeFp += 1;
			}
		}
		if (c.cleanPr) {
			cleanCases += 1;
			const blocked = c.blocked ?? c.findings.some(isBlocking);
			if (blocked) falseBlocks += 1;
		}
	}
	return {
		cases: cases.length,
		truePositives: tp,
		falsePositives: fp,
		missed,
		cleanCases,
		falseBlocks,
		precision: metric(tp, tp + fp),
		recall: metric(tp, tp + missed),
		severePrecision: metric(severeTp, severeTp + severeFp),
		falseBlockRate: metric(falseBlocks, cleanCases),
	};
}

/**
 * Label published findings against seeded defects by exact anchor. Returns the
 * labelled findings and how many seeded defects were not published.
 */
export function labelByAnchor(
	published: ReadonlyArray<{
		path: string;
		line: number;
		severity: EvalSeverity;
	}>,
	seeded: ReadonlyArray<{ path: string; line: number }>
): Pick<ScoredCase, 'findings' | 'missed'> {
	const key = (a: { path: string; line: number }) => `${a.path}:${a.line}`;
	const seededKeys = new Set(seeded.map(key));
	const found = new Set<string>();
	const findings = published.map((finding): LabelledFinding => {
		const hit = seededKeys.has(key(finding));
		if (hit) found.add(key(finding));
		return { label: hit ? 'tp' : 'fp', severity: finding.severity };
	});
	return { findings, missed: seededKeys.size - found.size };
}

const SEVERITIES: readonly string[] = ['critical', 'high', 'medium', 'low'];

/**
 * Validate adjudicated results loaded from JSON (for example real model output
 * labelled by a human). Throws with the offending path on any malformed entry.
 */
export function parseScoredCases(input: unknown): ScoredCase[] {
	const list = (input as { cases?: unknown })?.cases;
	if (!Array.isArray(list))
		throw new Error('scored input must be an object with a "cases" array');
	return list.map((raw, index): ScoredCase => {
		const where = `cases[${index}]`;
		const c = raw as Record<string, unknown>;
		if (typeof c?.id !== 'string' || c.id === '')
			throw new Error(`${where}.id must be a non-empty string`);
		if (typeof c.cleanPr !== 'boolean')
			throw new Error(`${where}.cleanPr must be a boolean`);
		if (!Array.isArray(c.findings))
			throw new Error(`${where}.findings must be an array`);
		const findings = c.findings.map((item, i): LabelledFinding => {
			const f = item as Record<string, unknown>;
			if (f?.label !== 'tp' && f?.label !== 'fp')
				throw new Error(`${where}.findings[${i}].label must be "tp" or "fp"`);
			if (typeof f.severity !== 'string' || !SEVERITIES.includes(f.severity))
				throw new Error(`${where}.findings[${i}].severity is not valid`);
			return { label: f.label, severity: f.severity as EvalSeverity };
		});
		const missed = c.missed ?? 0;
		if (typeof missed !== 'number' || !Number.isInteger(missed) || missed < 0)
			throw new Error(`${where}.missed must be a non-negative integer`);
		return {
			id: c.id,
			cleanPr: c.cleanPr,
			findings,
			missed,
			...(typeof c.blocked === 'boolean' ? { blocked: c.blocked } : {}),
		};
	});
}

function percent(value: number | null): string {
	return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function interval(i: Interval | null): string {
	return i ? `[${percent(i.low)}, ${percent(i.high)}]` : 'n/a';
}

/** Render a plain-text table. Targets are labelled as proposed, not measured. */
export function formatScoreTable(summary: ScoreSummary): string {
	const t = PROPOSED_TARGETS;
	const rows: string[][] = [
		['Metric', 'Value', 'n', '95% Wilson', 'Proposed target'],
		[
			'Precision (all)',
			percent(summary.precision.value),
			`${summary.precision.numerator}/${summary.precision.denominator}`,
			interval(summary.precision.interval),
			'none set',
		],
		[
			'Precision (high+critical)',
			percent(summary.severePrecision.value),
			`${summary.severePrecision.numerator}/${summary.severePrecision.denominator}`,
			interval(summary.severePrecision.interval),
			`>= ${percent(t.severePrecision.min)}, lower bound >= ${percent(t.severePrecision.minLowerBound)}, n >= ${t.severePrecision.minSamples}`,
		],
		[
			'Recall (seeded)',
			percent(summary.recall.value),
			`${summary.recall.numerator}/${summary.recall.denominator}`,
			interval(summary.recall.interval),
			`>= ${percent(t.recall.min)} (severe, holdout)`,
		],
		[
			'False-block rate',
			percent(summary.falseBlockRate.value),
			`${summary.falseBlockRate.numerator}/${summary.falseBlockRate.denominator}`,
			interval(summary.falseBlockRate.interval),
			`<= ${percent(t.falseBlockRate.max)}, upper bound <= ${percent(t.falseBlockRate.maxUpperBound)}, n >= ${t.falseBlockRate.minSamples}`,
		],
	];
	const widths = rows[0].map((_, col) =>
		Math.max(...rows.map((row) => row[col].length))
	);
	const line = (row: string[]) =>
		row
			.map((cell, col) => cell.padEnd(widths[col]))
			.join('  ')
			.trimEnd();
	return [
		line(rows[0]),
		line(widths.map((w) => '-'.repeat(w))),
		...rows.slice(1).map(line),
		'Targets are proposed in docs/research/improvement-roadmap.md; they are not measured results.',
	].join('\n');
}
