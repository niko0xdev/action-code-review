import { describe, expect, it } from 'vitest';
import { buildSummaryBody } from '../../src/github/comments.js';
import { buildJobSummary } from '../../src/github/review.js';
import {
	buildReviewReport,
	serializeReviewReport,
} from '../../src/review/report.js';
import {
	applyVerifyPass,
	sanitiseVerifyReason,
} from '../../src/review/verify.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';
import { CANARIES } from '../eval/helpers/canaries.js';

const tokens = [CANARIES.githubToken.core, CANARIES.openaiKey.core];
const leaky = `LLM request failed: 401 {"error":"key ${tokens[1]}\n and ${tokens[0]}"}`;

function mkResult(): ReviewResult {
	const finding: Finding = {
		severity: 'high',
		confidence: 0.9,
		category: 'correctness',
		path: 'src/app.ts',
		line: 1,
		title: 't',
		description: 'd',
		impact: 'i',
	};
	return {
		findings: [finding],
		summary: '',
		risk: 'high',
		counts: { critical: 0, high: 1, medium: 0, low: 0 },
		filesReviewed: ['src/app.ts'],
		reviewStatus: 'complete',
	};
}

function expectNoTokens(text: string) {
	for (const t of tokens) expect(text).not.toContain(t);
}

describe('verify skip reason redaction', () => {
	it('sanitiseVerifyReason redacts, collapses whitespace, and caps length', () => {
		const out = sanitiseVerifyReason(`${leaky} ${'x'.repeat(500)}`);
		expectNoTokens(out);
		expect(out).not.toMatch(/\s{2}|\n/);
		expect(out.length).toBeLessThanOrEqual(200);
	});

	it('never lets a token from a failing verify call reach any sink', async () => {
		const result = mkResult();
		await applyVerifyPass(result, {
			toolFindings: [],
			title: 't',
			body: '',
			verify: async () => {
				throw new Error(leaky);
			},
		});
		const reason = result.diagnostics?.verifySkippedReason ?? '';
		expect(reason).toContain('verify call failed');
		expectNoTokens(reason);
		expect(reason.length).toBeLessThanOrEqual(200);
		expectNoTokens(
			buildSummaryBody({
				...result,
				model: 'm',
			})
		);
		expectNoTokens(
			buildJobSummary({
				filesReviewed: result.filesReviewed,
				result,
				diagnostics: result.diagnostics,
			})
		);
		expectNoTokens(
			serializeReviewReport(buildReviewReport({ result, filesTotal: 1 }))
		);
	});

	it('redacts at the render sinks even if a raw reason is stored', () => {
		const result = {
			...mkResult(),
			diagnostics: { verifySkippedReason: leaky },
		};
		const comment = buildSummaryBody({ ...result, model: 'm' });
		expect(comment).toContain('Verify pass:');
		expectNoTokens(comment);
		expectNoTokens(
			buildJobSummary({
				filesReviewed: result.filesReviewed,
				result,
				diagnostics: result.diagnostics,
			})
		);
	});
});
