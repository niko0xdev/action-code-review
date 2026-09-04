import { describe, expect, it } from 'vitest';
import { dedupeFindings } from '../../src/review/dedupe.js';
import { normalizeCommentId } from '../../src/review/dedupe.js';
import type { Finding } from '../../src/types/finding.js';

function f(overrides: Partial<Finding>): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'correctness',
		path: 'src/a.ts',
		line: 10,
		title: 'Issue',
		description: 'd',
		impact: 'i',
		...overrides,
	};
}

describe('dedupeFindings', () => {
	it('removes exact duplicates (same path+line+category)', () => {
		const kept = dedupeFindings([f({}), f({ confidence: 0.95 })]);
		expect(kept).toHaveLength(1);
		expect(kept[0].confidence).toBe(0.95); // keeps the stronger one
	});

	it('keeps distinct findings on different lines', () => {
		expect(dedupeFindings([f({ line: 10 }), f({ line: 20 })])).toHaveLength(2);
	});

	it('keeps same line with different categories', () => {
		expect(
			dedupeFindings([
				f({ category: 'security' }),
				f({ category: 'performance' }),
			])
		).toHaveLength(2);
	});

	it('treats similar titles on the same line as duplicates', () => {
		const kept = dedupeFindings([
			f({ title: 'Missing tenant filter in query' }),
			f({
				title: 'missing tenant filter in the query',
				confidence: 0.99,
			}),
		]);
		expect(kept).toHaveLength(1);
		expect(kept[0].confidence).toBe(0.99);
	});
});

describe('normalizeCommentId', () => {
	it('is stable for identical findings', () => {
		const id1 = normalizeCommentId(f({}));
		const id2 = normalizeCommentId(f({}));
		expect(id1).toBe(id2);
	});

	it('matches the legacy 12-hex format', () => {
		expect(normalizeCommentId(f({}))).toMatch(/^[a-f0-9]{12}$/);
	});

	it('differs when path or line changes', () => {
		const a = normalizeCommentId(f({}));
		const b = normalizeCommentId(f({ line: 11 }));
		expect(a).not.toBe(b);
	});
});
