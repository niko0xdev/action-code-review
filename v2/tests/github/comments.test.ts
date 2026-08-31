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
