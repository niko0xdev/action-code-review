import { describe, expect, it } from 'vitest';
import type {
	SecurityContext,
	SecurityFinding,
} from '../../src/security/types.js';
import { applyQualityGate } from '../../src/security/validators/quality-gate.js';

describe('QualityGate', () => {
	const mockContext: SecurityContext = {
		repositoryPath: '/app',
		owner: 'org',
		repo: 'repo',
		changedFiles: [
			{
				filename: 'src/auth.ts',
				status: 'modified',
				additions: 10,
				deletions: 2,
			},
			{ filename: 'src/db.ts', status: 'modified', additions: 5, deletions: 1 },
		],
		options: {
			mode: 'security',
			profile: 'diff',
			minSeverity: 'medium',
			failOn: 'critical',
			confirmFindings: true,
			inlineComments: true,
			stickyComment: true,
			generateSarif: true,
			maxFindings: 20,
			riskThreshold: 'high',
		},
	};

	it('filters out findings on files not changed in PR', () => {
		const candidates: SecurityFinding[] = [
			{
				id: '1',
				fingerprint: 'fp1',
				title: 'Valid PR Issue',
				severity: 'high',
				confidence: 'high',
				status: 'candidate',
				file: 'src/auth.ts',
				startLine: 12,
				evidence: [{ type: 'code', description: 'Token check bypassed' }],
				exploitability: 'likely',
			},
			{
				id: '2',
				fingerprint: 'fp2',
				title: 'Untouched File Issue',
				severity: 'high',
				confidence: 'high',
				status: 'candidate',
				file: 'src/unrelated.ts',
				startLine: 50,
				evidence: [{ type: 'code', description: 'Old issue' }],
				exploitability: 'likely',
			},
		];

		const res = applyQualityGate(
			candidates,
			mockContext,
			'medium',
			'medium',
			20
		);
		expect(res.validated).toHaveLength(1);
		expect(res.validated[0].file).toBe('src/auth.ts');
		expect(res.rejected).toHaveLength(1);
		expect(res.rejected[0].file).toBe('src/unrelated.ts');
	});

	it('filters out low-confidence findings below threshold', () => {
		const candidates: SecurityFinding[] = [
			{
				id: '1',
				fingerprint: 'fp1',
				title: 'Low confidence speculation',
				severity: 'high',
				confidence: 'low',
				status: 'candidate',
				file: 'src/auth.ts',
				evidence: [{ type: 'reasoning', description: 'Maybe insecure' }],
				exploitability: 'unknown',
			},
		];

		const res = applyQualityGate(
			candidates,
			mockContext,
			'medium',
			'medium',
			20
		);
		expect(res.validated).toHaveLength(0);
		expect(res.rejected).toHaveLength(1);
	});

	it('filters out findings below minimum publish severity', () => {
		const candidates: SecurityFinding[] = [
			{
				id: '1',
				fingerprint: 'fp1',
				title: 'Informational note',
				severity: 'info',
				confidence: 'high',
				status: 'candidate',
				file: 'src/auth.ts',
				evidence: [{ type: 'code', description: 'Consider logging' }],
				exploitability: 'unknown',
			},
		];

		const res = applyQualityGate(
			candidates,
			mockContext,
			'medium',
			'medium',
			20
		);
		expect(res.validated).toHaveLength(0);
		expect(res.rejected).toHaveLength(1);
	});

	it('caps findings at maxFindings limit and sorts by severity desc', () => {
		const candidates: SecurityFinding[] = [];
		for (let i = 1; i <= 10; i++) {
			candidates.push({
				id: `cand-${i}`,
				fingerprint: `fp-${i}`,
				title: `Issue ${i}`,
				severity: i === 10 ? 'critical' : 'medium',
				confidence: 'high',
				status: 'candidate',
				file: 'src/auth.ts',
				startLine: i,
				evidence: [{ type: 'code', description: `Evidence ${i}` }],
				exploitability: 'likely',
			});
		}

		const res = applyQualityGate(
			candidates,
			mockContext,
			'medium',
			'medium',
			3
		);
		expect(res.validated).toHaveLength(3);
		expect(res.validated[0].severity).toBe('critical');
		expect(res.rejected).toHaveLength(7);
	});
});

describe('scope validation before occurrence deduplication', () => {
	const finding: SecurityFinding = {
		id: 'one',
		fingerprint: 'rule',
		title: 'Injection',
		severity: 'high',
		confidence: 'high',
		status: 'candidate',
		file: 'src/auth.ts',
		startLine: 1,
		evidence: [{ type: 'code', description: 'SQL reaches query' }],
		exploitability: 'likely',
	};
	const context = {
		repositoryPath: '/repo',
		changedFiles: [
			{
				filename: 'src/auth.ts',
				patch: '@@ -99,1 +99,2 @@\n unchanged\n+query(input)',
				status: 'modified',
				additions: 1,
				deletions: 0,
			},
		],
	} as SecurityContext;

	it.each([false, true])(
		'retains the changed occurrence regardless of candidate order: %s',
		(reverse) => {
			const candidates = [finding, { ...finding, startLine: 100 }];
			const result = applyQualityGate(
				reverse ? candidates.reverse() : candidates,
				context
			);
			expect(result.validated).toHaveLength(1);
			expect(result.validated[0].startLine).toBe(100);
			expect(result.rejected).toHaveLength(1);
		}
	);

	it('cannot borrow confidence or evidence from an out-of-scope occurrence', () => {
		const result = applyQualityGate(
			[
				finding,
				{ ...finding, startLine: 100, confidence: 'low', evidence: [] },
			],
			context
		);
		expect(result.validated).toHaveLength(0);
		expect(result.rejected).toHaveLength(2);
	});

	it('does not modify the candidates when publication rejects them', () => {
		const candidates = [structuredClone({ ...finding, startLine: 100 })];
		const before = structuredClone(candidates);
		applyQualityGate(candidates, context, 'critical');
		expect(candidates).toEqual(before);
	});
});
