import { describe, expect, it } from 'vitest';
import {
	decodeLedger,
	diffLedger,
	encodeLedger,
	findingIdentity,
	nextLedger,
	stableCommentId,
} from '../../src/review/ledger.js';
import type { Finding } from '../../src/types/finding.js';

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		path: 'src/a.ts',
		line: 10,
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		title: 'Unchecked authorisation check',
		description: 'The role is not verified.',
		impact: 'Data exposure.',
		...overrides,
	};
}

describe('finding identity', () => {
	it('ignores the wording and the line, so a reworded finding is the same finding', () => {
		const first = finding();
		const reworded = finding({
			title: 'Unchecked authorisation check on the export path',
			description: 'Different wording.',
			line: 42,
		});
		expect(findingIdentity(reworded)).toBe(findingIdentity(first));
	});

	it('uses the rule id the model supplies, so any wording keeps the identity', () => {
		const first = finding({ ruleId: 'security/authz-missing' });
		const reworded = finding({
			ruleId: 'security/authz-missing',
			title: 'Something completely different now',
			line: 99,
		});
		expect(findingIdentity(reworded)).toBe(findingIdentity(first));
	});

	it('separates different files, categories, and rules', () => {
		const base = finding();
		expect(findingIdentity(finding({ path: 'src/b.ts' }))).not.toBe(
			findingIdentity(base)
		);
		expect(findingIdentity(finding({ category: 'correctness' }))).not.toBe(
			findingIdentity(base)
		);
		expect(findingIdentity(finding({ ruleId: 'rule-x' }))).not.toBe(
			findingIdentity(base)
		);
	});

	it('keeps the inline comment identity anchored to the line', () => {
		expect(stableCommentId(finding({ line: 11 }))).not.toBe(
			stableCommentId(finding({ line: 10 }))
		);
		expect(
			stableCommentId(finding({ title: 'Unchecked authorisation check here' }))
		).toBe(stableCommentId(finding()));
	});
});

describe('ledger encoding', () => {
	it('round-trips through the stored payload', () => {
		const ledger = {
			v: 1,
			head: 'abc',
			findings: [
				{
					id: 'x',
					category: 'security',
					severity: 'high' as const,
					title: 't',
					path: 'src/a.ts',
					line: 3,
					status: 'open' as const,
				},
			],
		};
		const encoded = encodeLedger(ledger);
		expect(encoded).not.toContain('-->');
		expect(decodeLedger(encoded)).toEqual(ledger);
	});

	it('ignores a payload that is not a ledger of this version', () => {
		expect(decodeLedger('not base64 json')).toBeUndefined();
		expect(
			decodeLedger(Buffer.from('{"v":99}').toString('base64'))
		).toBeUndefined();
	});
});

describe('diffLedger', () => {
	const open = finding();
	const previous = {
		v: 1,
		head: 'old',
		findings: [
			{
				id: findingIdentity(open),
				category: open.category,
				severity: 'high' as const,
				title: open.title,
				path: open.path,
				line: open.line,
				status: 'open' as const,
			},
		],
	};

	it('separates new, still open, fixed, and regressed findings', () => {
		const current = [finding({ path: 'src/b.ts', title: 'A brand new issue' })];
		const delta = diffLedger(
			previous,
			current,
			new Set(['src/a.ts', 'src/b.ts'])
		);
		expect(delta.new.map((f) => f.path)).toEqual(['src/b.ts']);
		expect(delta.stillOpen).toEqual([]);
		expect(delta.fixed.map((f) => f.id)).toEqual([findingIdentity(open)]);
		expect(delta.regressed).toEqual([]);
	});

	it('carries a finding over when its file was not reviewed again', () => {
		const delta = diffLedger(previous, [], new Set(['src/other.ts']));
		expect(delta.fixed).toEqual([]);
		expect(delta.stillOpen.map((f) => f.id)).toEqual([findingIdentity(open)]);
	});

	it('recognises a finding that comes back as regressed', () => {
		const fixed = {
			...previous,
			findings: previous.findings.map((f) => ({
				...f,
				status: 'fixed' as const,
			})),
		};
		const delta = diffLedger(fixed, [finding()], new Set(['src/a.ts']));
		expect(delta.regressed.map((f) => f.id)).toEqual([findingIdentity(open)]);
	});
});

describe('nextLedger', () => {
	it('keeps a fixed finding so a later run can recognise it coming back', () => {
		const previous = {
			v: 1,
			head: 'old',
			findings: [
				{
					id: findingIdentity(finding()),
					category: finding().category,
					severity: 'high' as const,
					title: finding().title,
					path: finding().path,
					line: finding().line,
					status: 'open' as const,
				},
			],
		};
		const next = nextLedger(previous, [], 'new');
		expect(next.head).toBe('new');
		expect(next.findings.map((f) => f.status)).toEqual(['fixed']);
	});
});

describe('the ledger in the summary and the report', () => {
	it('reports what changed since the last review', async () => {
		const { buildSummaryBody } = await import('../../src/github/comments.js');
		const body = buildSummaryBody({
			risk: 'high',
			counts: { critical: 0, high: 1, medium: 0, low: 0 },
			filesReviewed: ['src/a.ts'],
			ledger: {
				head: 'abc',
				payload: 'x',
				new: 2,
				stillOpen: 1,
				fixed: 3,
				regressed: 0,
				incremental: true,
			},
		});
		expect(body).toContain('2 new, 1 still open, 3 fixed, 0 regressed');
		expect(body).toContain('only the changed files were reviewed again');
	});

	it('leaves the summary unchanged without a ledger', async () => {
		const { buildSummaryBody } = await import('../../src/github/comments.js');
		const body = buildSummaryBody({
			risk: 'low',
			counts: { critical: 0, high: 0, medium: 0, low: 0 },
			filesReviewed: [],
		});
		expect(body).not.toContain('Findings since the last review');
	});
});
