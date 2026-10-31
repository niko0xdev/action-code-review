import { afterEach, describe, expect, it, vi } from 'vitest';
import { runReview } from '../../src/review/reviewer.js';
import { applyVerifyPass } from '../../src/review/verify.js';
import { loadStubbedScenarios } from './helpers/fixtures.js';
import { makeContext, stubHarness } from './helpers/pipeline.js';
import {
	type ScoredCase,
	formatScoreTable,
	isBlocking,
	labelByAnchor,
	scoreCases,
} from './scoring.js';

/**
 * Clean and seeded diffs replayed against canned model replies. The point is
 * what the deterministic gates (validator, dedupe, severity, category
 * bucketing, stubbed verify pass) do with noisy output, and how that scores.
 */

const scenarios = loadStubbedScenarios();

afterEach(() => {
	vi.restoreAllMocks();
});

async function run(s: (typeof scenarios)[number]) {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	const context = makeContext(s.files);
	const result = await runReview(context, stubHarness(s.modelOutput), {
		...(s.minSeverity ? { minSeverity: s.minSeverity } : {}),
	});
	if (s.verifyOutput !== undefined) {
		const verdict = s.verifyOutput;
		await applyVerifyPass(result, {
			toolFindings: [],
			title: context.pullRequest.title,
			body: context.pullRequest.body,
			verify: async () => JSON.stringify(verdict),
		});
	}
	return result;
}

describe.each(scenarios)('stubbed provider: $id', (s) => {
	it(s.description, async () => {
		const result = await run(s);
		expect(result.findings.map((f) => [f.path, f.line])).toEqual(s.published);
		expect(result.findings.some(isBlocking)).toBe(s.blocked);
		// None of these scenarios is a failure; none may report incomplete.
		expect(result.reviewStatus).toBe('complete');
	});
});

describe('scored set', () => {
	async function scored(): Promise<ScoredCase[]> {
		const out: ScoredCase[] = [];
		for (const s of scenarios) {
			const result = await run(s);
			out.push({
				id: s.id,
				cleanPr: s.cleanPr,
				...labelByAnchor(result.findings, s.seededDefects),
			});
		}
		return out;
	}

	// These numbers describe the canned set, not any model. They change only
	// when a gate starts accepting or rejecting different shapes of output.
	it('scores the canned set deterministically', async () => {
		const summary = scoreCases(await scored());
		expect(summary.truePositives).toBe(2);
		expect(summary.falsePositives).toBe(4);
		expect(summary.missed).toBe(1);
		expect(summary.cleanCases).toBe(12);
		expect(summary.falseBlocks).toBe(2);
		expect(summary.precision.value).toBeCloseTo(2 / 6, 10);
		expect(summary.recall.value).toBeCloseTo(2 / 3, 10);
		expect(summary.severePrecision.value).toBeCloseTo(2 / 3, 10);
		expect(summary.falseBlockRate.value).toBeCloseTo(2 / 12, 10);
		if (process.env.EVAL_VERBOSE) console.log(formatScoreTable(summary));
	});

	it('is stable across repeated runs', async () => {
		const first = scoreCases(await scored());
		const second = scoreCases(await scored());
		expect(second).toEqual(first);
	});
});

describe('verify pass on stubbed provider', () => {
	it('keeps every finding when the verify reply is unusable', async () => {
		const s = scenarios.find((x) => x.id === 'wrong-claim-valid-anchor');
		expect(s).toBeDefined();
		const context = makeContext((s as (typeof scenarios)[number]).files);
		const result = await runReview(
			context,
			stubHarness((s as (typeof scenarios)[number]).modelOutput)
		);
		const before = result.findings.length;
		await applyVerifyPass(result, {
			toolFindings: [],
			title: 't',
			body: '',
			verify: async () => 'no verdict available',
		});
		expect(result.findings).toHaveLength(before);
		expect(result.reviewStatus).toBe('incomplete');
	});
});

// Keep the file honest if a scenario is added without a metric consequence.
it('has both clean and seeded scenarios', () => {
	expect(scenarios.some((s) => s.cleanPr)).toBe(true);
	expect(scenarios.some((s) => s.seededDefects.length > 0)).toBe(true);
});
