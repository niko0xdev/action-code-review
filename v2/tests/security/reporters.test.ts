import { describe, expect, it } from 'vitest';
import { buildFullAuditReport } from '../../src/security/reporters/audit-reporter.js';
import { formatInlineSecurityComment } from '../../src/security/reporters/inline-reporter.js';
import { buildStickySecuritySummary } from '../../src/security/reporters/sticky-summary.js';
import type { SecurityFinding } from '../../src/security/types.js';

describe('SecurityReporters', () => {
	const sampleFinding: SecurityFinding = {
		id: 'sec-idor-1',
		fingerprint: 'fp-idor-12345678',
		title: 'Missing Tenant Authorization Check',
		severity: 'high',
		confidence: 'high',
		status: 'validated',
		cwe: 'CWE-862',
		owasp: 'A01:2021-Broken Access Control',
		file: 'src/api/projects.ts',
		startLine: 24,
		endLine: 28,
		evidence: [
			{
				type: 'code',
				description:
					'Project ID from URL route used directly without verifying caller membership.',
			},
		],
		exploitability: 'likely',
		remediation:
			'Verify user organization membership before exporting project data.',
	};

	it('formats developer-actionable inline comments with fingerprint marker and remediation', () => {
		const comment = formatInlineSecurityComment(sampleFinding);
		expect(comment).toContain('<!-- ai-review-id: fp-idor-12345678 -->');
		expect(comment).toContain(
			'**HIGH** · CWE-862 · **Missing Tenant Authorization Check**'
		);
		expect(comment).toContain('Evidence:');
		expect(comment).toContain('Recommended fix:');
		expect(comment).toContain('**Confidence:** HIGH');
	});

	it('builds sticky security summary with scanner statuses and domains', () => {
		const summary = buildStickySecuritySummary({
			risk: 'high',
			validatedCount: 1,
			rejectedCount: 3,
			findings: [sampleFinding],
			scanners: [
				{ name: 'secret-scan', status: 'success', findings: 0, durationMs: 12 },
				{ name: 'semgrep', status: 'success', findings: 1, durationMs: 450 },
			],
			domains: ['authorization', 'authentication'],
		});

		expect(summary).toContain('<!-- nim-security-sticky-summary -->');
		expect(summary).toContain('## 🔐 Nim Security Review');
		expect(summary).toContain('**Risk:** `HIGH`');
		expect(summary).toContain('Validated findings');
		expect(summary).toContain('✓ **semgrep**');
		expect(summary).toContain('• authorization');
	});

	it('builds comprehensive full audit report markdown', () => {
		const report = buildFullAuditReport({
			owner: 'org',
			repo: 'repo',
			profile: 'balanced',
			riskClassification: {
				level: 'high',
				reasons: ['Changes in auth logic'],
				domains: ['authorization'],
				changedFiles: ['src/api/projects.ts'],
			},
			findings: [sampleFinding],
			scanners: [
				{ name: 'semgrep', status: 'success', findings: 1, durationMs: 50 },
			],
		});

		expect(report).toContain('# Security Audit Report — org/repo');
		expect(report).toContain('Audit Profile:** `balanced`');
		expect(report).toContain('1. Missing Tenant Authorization Check');
		expect(report).toContain('CWE-862');
	});
});
