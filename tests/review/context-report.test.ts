import { describe, expect, it } from 'vitest';
import {
	buildReviewReport,
	serializeReviewReport,
} from '../../src/review/report.js';
import type { ReviewResult } from '../../src/types/finding.js';

describe('prompt supply report', () => {
	it('copies supplied and omitted paths without claiming inspection or complete coverage', () => {
		const result: ReviewResult = {
			findings: [],
			summary: '',
			risk: 'none',
			counts: { critical: 0, high: 0, medium: 0, low: 0 },
			filesReviewed: ['a.ts'],
			reviewStatus: 'complete',
			contextCoverage: { suppliedPaths: ['a.ts'], omittedPaths: ['b.ts'] },
		};
		const report = buildReviewReport({
			result,
			filesTotal: 2,
			filesExcluded: 0,
		});
		expect(JSON.parse(serializeReviewReport(report)).contextCoverage).toEqual(
			result.contextCoverage
		);
		expect(report.status).toBe('incomplete');
		report.contextCoverage?.suppliedPaths.push('mutated.ts');
		expect(result.contextCoverage?.suppliedPaths).toEqual(['a.ts']);
	});
});

it('preserves verifier verdicts and copies their evidence references in the output', () => {
	const result: ReviewResult = {
		findings: [],
		summary: '',
		risk: 'none',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: ['a.ts'],
		reviewStatus: 'incomplete',
		diagnostics: {
			verifyStatus: 'incomplete',
			verifyVerdicts: [
				{
					id: 'c1',
					verdict: 'uncertain',
					reason: 'The supplied source does not establish the claim.',
					evidenceIds: ['e1'],
				},
			],
		},
	};
	const report = buildReviewReport({ result, filesTotal: 1, filesExcluded: 0 });
	expect(
		JSON.parse(serializeReviewReport(report)).diagnostics.verifyVerdicts
	).toEqual(result.diagnostics?.verifyVerdicts);
	report.diagnostics?.verifyVerdicts?.[0].evidenceIds.push('mutated');
	expect(result.diagnostics?.verifyVerdicts?.[0].evidenceIds).toEqual(['e1']);
});
