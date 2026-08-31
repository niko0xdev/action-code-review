import { describe, expect, it } from 'vitest';
import { buildFindingBody } from '../../src/github/comments.js';
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

describe('buildFindingBody', () => {
	it('escapes HTML payloads as literal text', () => {
		const body = buildFindingBody(
			finding({ title: '<img onerror=alert(1)>', description: 'javascript:alert(1)' })
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
