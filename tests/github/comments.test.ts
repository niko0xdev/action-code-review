import { describe, expect, it } from 'vitest';
import {
	buildFindingBody,
	buildSummaryBody,
	formatDecisionBanner,
} from '../../src/github/comments.js';
import { normalizeCommentId } from '../../src/review/dedupe.js';
import type { Finding } from '../../src/types/finding.js';

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		path: 'src/a.ts',
		line: 4,
		title: 'Unsafe title',
		description: 'Unsafe description',
		impact: 'Unsafe impact',
		...overrides,
	};
}

describe('buildSummaryBody', () => {
	const empty = {
		risk: 'none' as const,
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: ['a.ts'],
		model: 'test-model',
	};

	it('renders approved rich summary with all-zero findings', () => {
		const body = buildSummaryBody(empty);
		expect(body).toContain('> ✨ **APPROVED**');
		expect(body).toContain('| 🚨 Critical | 0 | ✅ |');
		expect(body).toContain('✅ **All clear**');
	});

	it('renders blocking high findings and sorts top findings', () => {
		const high = finding({ severity: 'high', confidence: 0.92 });
		const body = buildSummaryBody({
			...empty,
			risk: 'high',
			findings: [high],
			counts: { critical: 0, high: 1, medium: 0, low: 0 },
		});
		expect(body).toContain('> ⚠️ **CHANGES REQUESTED**');
		expect(body).toContain('| 🔥 High | 1 | ❌ |');
		expect(body).toContain('src/a.ts:4');
	});

	it('approves all-low findings', () => {
		const body = buildSummaryBody({
			...empty,
			findings: [finding({ severity: 'low' })],
			counts: { critical: 0, high: 0, medium: 0, low: 1 },
		});
		expect(body).toContain('> ✨ **APPROVED**');
	});

	it('includes optional summary, metadata, footer link, and no empty paragraph', () => {
		process.env.GITHUB_REPOSITORY = 'acme/widget';
		process.env.GITHUB_RUN_ID = '42';
		const body = buildSummaryBody({
			...empty,
			summary: 'Summary text',
			filesReviewed: ['a.ts', 'b.ts', 'c.ts'],
			durationMs: 12_300,
			filesTotal: 7,
			filesExcluded: 4,
		});
		expect(body).toContain('Summary text');
		expect(body).toContain('12.3s');
		expect(body).toContain('3 of 7 (4 excluded by filter)');
		expect(body).toContain('actions/runs/42');
		expect(body).not.toContain('undefined');
	});

	it('formats critical banner', () => {
		expect(formatDecisionBanner('critical')).toContain('CRITICAL');
	});
});

describe('buildFindingBody', () => {
	it('escapes HTML payloads as literal text', () => {
		const body = buildFindingBody(
			finding({
				title: '<img onerror=alert(1)>',
				description: 'javascript:alert(1)',
			})
		);
		expect(body).toContain('&lt;img onerror=alert(1)&gt;');
		expect(body).toContain('javascript:alert(1)');
		expect(body).not.toContain('<img');
	});

	it('keeps legacy identity stable while escaping output', () => {
		const item = finding({ title: '<b>x</b>' });
		const body = buildFindingBody(item);
		expect(body).toContain(`ai-review-id:${normalizeCommentId(item)}`);
	});
});

describe('buildSummaryBody - tool findings + diagnostics (Q3)', () => {
	const base = {
		risk: 'medium' as const,
		counts: { critical: 0, high: 1, medium: 2, low: 0 },
		filesReviewed: ['a.ts'],
		model: 'test-model',
	};

	it('omits details blocks when neither toolFindings nor diagnostics provided', () => {
		const body = buildSummaryBody(base);
		expect(body).not.toContain('<details>');
	});

	it('renders toolFindings in collapsible block', () => {
		const body = buildSummaryBody({
			...base,
			toolFindings: [
				{
					tool: 'biome',
					code: 'no-unused',
					path: 'src/a.ts',
					line: 4,
					severity: 'medium',
					message: 'unused var',
				},
			],
		});
		expect(body).toContain(
			'<details><summary>Static analyzer findings</summary>'
		);
		expect(body).toContain('[`biome/no-unused`]');
		expect(body).toContain('src/a.ts:4');
		expect(body).toContain('</details>');
	});

	it('truncates long toolFindings lists with "more" line', () => {
		const many = Array.from({ length: 25 }, (_, i) => ({
			tool: 'biome',
			code: `R${i}`,
			path: `src/f${i}.ts`,
			line: i + 1,
			severity: 'low' as const,
			message: `m ${i}`,
		}));
		const body = buildSummaryBody({ ...base, toolFindings: many });
		expect(body).toContain('... and 5 more');
	});

	it('renders diagnostics in collapsible block', () => {
		const body = buildSummaryBody({
			...base,
			diagnostics: {
				prelintRan: ['biome', 'ruff'],
				prelintSkipped: ['swiftlint (binary not found)'],
				bucketedUnknownCategories: 1,
				crossFindingConflictsResolved: 0,
				trivialPrFastPath: false,
			},
		});
		expect(body).toContain('<details><summary>Pipeline diagnostics</summary>');
		expect(body).toContain('**Tools ran:** biome, ruff');
		expect(body).toContain('**Tools skipped:** swiftlint (binary not found)');
		expect(body).toContain('**Bucketed (unknown category -> low):** 1');
		expect(body).toContain('**Trivial-PR fast path:** no');
	});

	it('omits diagnostics block when all fields undefined', () => {
		const body = buildSummaryBody({
			...base,
			diagnostics: {},
		});
		expect(body).not.toContain('Pipeline diagnostics');
	});

	it('escapes malicious tool finding content', () => {
		const body = buildSummaryBody({
			...base,
			toolFindings: [
				{
					tool: 'biome',
					code: '<script>',
					path: 'src/a.ts',
					line: 1,
					severity: 'medium',
					message: '<img onerror=alert(1)>',
				},
			],
		});
		expect(body).not.toContain('<script>');
		expect(body).toContain('&lt;script&gt;');
		expect(body).toContain('&lt;img onerror=alert(1)&gt;');
	});

	it('keeps attribution as a hidden HTML comment, not visible markdown', () => {
		const body = buildSummaryBody(base);
		expect(body).toContain('<!-- Auto-generated by AI Code Review');
		expect(body).not.toMatch(/^_Auto-generated/m);
		expect(body).not.toContain('Auto-generated Auto-generated');
	});

	it('never shows a visible Model line', () => {
		const body = buildSummaryBody(base);
		expect(body).not.toContain('**Model:**');
		expect(body).not.toMatch(/^\*\*Model:\*\*/m);
	});

	it('does not render MiniMax-M3 as a visible model line', () => {
		const minimax = buildSummaryBody({ ...base, model: 'MiniMax-M3' });
		const visible = minimax.replace(/<!--[\s\S]*?-->/g, '');
		expect(visible).not.toContain('MiniMax-M3');
		expect(visible).not.toContain('Model:');
		expect(minimax).toContain('model: MiniMax-M3');
	});
});

describe('buildSummaryBody - hidden footer and checks table (Rules)', () => {
	const base2 = {
		risk: 'medium' as const,
		counts: { critical: 0, high: 1, medium: 0, low: 0 },
		filesReviewed: ['a.ts'],
		model: 'test-model',
	};

	it('Checks performed table has Rules and Failed rule columns', () => {
		const body = buildSummaryBody(base2);
		expect(body).toContain('| Check | Status | Rules | Failed rule |');
		expect(body).toContain('|-------|:------:|:-----:|');
	});

	it('shows N/A in Rules column when no coverage', () => {
		const body = buildSummaryBody(base2);
		expect(body).toContain('| N/A |');
		expect(body).toContain('| — |');
	});

	it('shows passed/total when ruleCoverage provided', () => {
		const body = buildSummaryBody({
			...base2,
			ruleCoverage: { total: 20, passed: 15, failedRules: ['rule-a'] },
		});
		expect(body).toContain('15/20 passed');
	});

	it('lists failed rules as bullets with escaping', () => {
		const body = buildSummaryBody({
			...base2,
			ruleCoverage: {
				total: 3,
				passed: 1,
				failedRules: ['rule|one', 'rule\ntwo'],
			},
		});
		expect(body).toContain('- rule\\|one');
		expect(body).toContain('- rule two');
		expect(body).not.toContain('rule|one');
	});

	it('escapes --> payload in hidden footer comment so it cannot break out', () => {
		const body = buildSummaryBody({ ...base2, model: 'a-->b' });
		expect(body).not.toContain('a-->b');
		const comment = body.match(/<!-- Auto-generated[\s\S]*?-->/)?.[0] ?? '';
		expect(comment).toContain('a- -');
		// The only --> left should be the comment's own terminator.
		expect(comment.replace(/-->$/, '')).not.toContain('-->');
	});
});
