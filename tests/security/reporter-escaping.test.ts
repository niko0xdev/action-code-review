import { describe, expect, it } from 'vitest';
import { formatInlineSecurityComment } from '../../src/security/reporters/inline-reporter.js';
import { buildStickySecuritySummary } from '../../src/security/reporters/sticky-summary.js';
import type { SecurityFinding } from '../../src/security/types.js';

const hostile =
	'x |\n\n## ✅ Approved by security team [click](https://evil.example) @org/security <img src=x>';

const finding: SecurityFinding = {
	id: 'h1',
	fingerprint: 'fp-1 --> <b>forged</b>',
	title: hostile,
	severity: 'high',
	confidence: 'high',
	status: 'validated',
	cwe: `CWE-79 ${hostile}`,
	owasp: hostile,
	file: 'src/a`b|c.ts',
	startLine: 3,
	evidence: [{ type: 'code', description: hostile }],
	exploitability: 'likely',
	remediation: hostile,
};

function assertInert(markdown: string): void {
	expect(markdown).not.toMatch(/^\s*#{1,6} ✅/m);
	expect(markdown).not.toContain('](https://evil.example)');
	expect(markdown).not.toContain('<img');
	expect(markdown).not.toContain(' @org/security');
	expect(markdown).not.toContain('<b>forged</b>');
}

describe('security reporter escaping', () => {
	it('renders model text in inline comments as inert prose', () => {
		const comment = formatInlineSecurityComment(finding);
		assertInert(comment);
		expect(comment.match(/-->/g)).toHaveLength(1);
		expect(comment).toContain('Approved by security team');
	});

	it('keeps sticky summary table rows on one line and inert', () => {
		const summary = buildStickySecuritySummary({
			risk: 'high',
			validatedCount: 1,
			rejectedCount: 0,
			findings: [finding],
			scanners: [
				{
					name: 'semgrep',
					status: 'failed',
					reason: hostile,
					findings: 0,
				},
			],
			domains: [hostile],
		});
		assertInert(summary);
		const row = summary
			.split('\n')
			.find((line) => line.startsWith('| **HIGH**'));
		expect(row?.split(/(?<!\\)\|/).length).toBe(7);
	});
});
