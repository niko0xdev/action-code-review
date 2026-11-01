import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	type ReviewHarness,
	buildReviewPrompt,
	parseHarnessFindings,
	toReviewResult,
} from '../../../src/harness/harness.js';
import { loadLlmConfigFromEnv } from '../../../src/llm/config.js';
import { OpenAiCompatibleProvider } from '../../../src/llm/openai-compatible.js';
import { runReview } from '../../../src/review/reviewer.js';
import { applyVerifyPass } from '../../../src/review/verify.js';
import type { Severity } from '../../../src/types/finding.js';
import { type ScoredCase, formatScoreTable, scoreCases } from '../scoring.js';
import { buildCase, labelFindings } from './build.js';
import { LIVE_CASES } from './cases.js';

/**
 * Live-model measurement. Skipped unless EVAL_LIVE=1, because it spends money.
 *
 *   EVAL_LIVE=1 OPENAI_API_KEY=... OPENAI_API_MODEL=... pnpm test:eval:live
 *
 * Optional: OPENAI_API_URL, EVAL_RUNS (repeats per case, default 1),
 * EVAL_VERIFY_MIN_SEVERITY (default high, the production default), and
 * EVAL_OUT (path for the raw JSON results).
 *
 * Each case runs the real prompt, parser, validator, and verify pass. The main
 * pass runs once per case and run; the verify variant reuses that reply, so the
 * two tables differ only by the verify pass.
 */

const live = process.env.EVAL_LIVE === '1';
const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1) || 1);
const floor = (process.env.EVAL_VERIFY_MIN_SEVERITY ?? 'high') as Severity;

describe.skipIf(!live)('live model measurement', () => {
	it(
		'scores the review with and without the verify pass',
		async () => {
			const provider = new OpenAiCompatibleProvider(loadLlmConfigFromEnv());
			const ask = async (prompt: string, maxOutputTokens: number) =>
				(
					await provider.complete([{ role: 'user', content: prompt }], {
						temperature: 0,
						maxOutputTokens,
					})
				).content;
			const harness: ReviewHarness = {
				name: 'live-direct',
				async review(context) {
					const raw = await ask(buildReviewPrompt(context), 4096);
					return toReviewResult(
						parseHarnessFindings(raw),
						context.diff.files.map((f) => f.filename)
					);
				},
			};

			const baseline: ScoredCase[] = [];
			const verified: ScoredCase[] = [];
			const raw: unknown[] = [];
			for (let run = 1; run <= runs; run++) {
				for (const c of LIVE_CASES) {
					const built = buildCase(c);
					const id = runs > 1 ? `${built.id}#${run}` : built.id;
					const result = await runReview(built.context, harness);
					const without = structuredClone(result);
					await applyVerifyPass(result, {
						toolFindings: [],
						title: built.context.pullRequest.title,
						body: built.context.pullRequest.body,
						verify: ask,
						minSeverity: floor,
					});
					baseline.push({
						id,
						cleanPr: built.cleanPr,
						...labelFindings(built, without.findings),
					});
					verified.push({
						id,
						cleanPr: built.cleanPr,
						...labelFindings(built, result.findings),
					});
					raw.push({
						id,
						status: result.reviewStatus ?? 'complete',
						verifyStatus: result.diagnostics?.verifyStatus,
						before: without.findings.map((f) => [f.path, f.line, f.severity]),
						after: result.findings.map((f) => [f.path, f.line, f.severity]),
					});
				}
			}

			const off = scoreCases(baseline);
			const on = scoreCases(verified);
			console.log(
				`\nCases: ${LIVE_CASES.length} x ${runs} run(s); verify floor: ${floor}\n\n--- Verify pass OFF ---\n${formatScoreTable(off)}\n\n--- Verify pass ON ---\n${formatScoreTable(on)}\n`
			);
			if (process.env.EVAL_OUT)
				writeFileSync(
					process.env.EVAL_OUT,
					JSON.stringify({ baseline, verified, raw }, null, 2)
				);
			expect(baseline).toHaveLength(LIVE_CASES.length * runs);
		},
		30 * 60 * 1000
	);
});
