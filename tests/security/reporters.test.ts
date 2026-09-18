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

	function auditOptions(
		findings: SecurityFinding[]
	): Parameters<typeof buildFullAuditReport>[0] {
		return {
			owner: 'org',
			repo: 'repo',
			profile: 'balanced',
			riskClassification: {
				level: 'high',
				reasons: ['Changes in auth logic'],
				domains: ['authorization'],
				changedFiles: ['src/api/projects.ts'],
			},
			findings,
			scanners: [
				{
					name: 'semgrep',
					status: 'success',
					findings: findings.length,
					durationMs: 50,
				},
			],
		};
	}

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

	it('marks a summary incomplete when an engine fails', () => {
		const summary = buildStickySecuritySummary({
			risk: 'low',
			validatedCount: 0,
			rejectedCount: 0,
			findings: [],
			scanners: [
				{ name: 'semgrep', status: 'failed', findings: 0, reason: 'timeout' },
			],
			domains: [],
			incomplete: true,
		});

		expect(summary).toContain('SECURITY REVIEW INCOMPLETE');
		expect(summary).toContain(
			'do not treat this report as a clean security pass'
		);
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

	describe('evidence context', () => {
		it('renders source, sink, ordered attack path, and evidence location', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						source: 'req.params.projectId',
						sink: 'projects.export(projectId)',
						attackPath: [
							'GET /projects/:id with no membership check',
							'handler forwards the route id to the service',
							'service exports any project id',
						],
						evidence: [
							{
								type: 'dataflow',
								description: 'Route id reaches the export query.',
								file: 'src/api/projects.ts',
								line: 24,
							},
							{
								type: 'code',
								description: 'Missing membership assertion.',
								file: 'src/api/projects.ts',
							},
						],
					},
				])
			);

			expect(report).toContain('- **Source:** `req.params.projectId`');
			expect(report).toContain('- **Sink:** `projects.export(projectId)`');
			expect(report).toContain('#### Attack Path:');
			expect(report).toContain(
				'- [dataflow] `src/api/projects.ts:24` — Route id reaches the export query.'
			);
			expect(report).toContain(
				'- [code] `src/api/projects.ts` — Missing membership assertion.'
			);

			const stepOne = report.indexOf(
				'GET /projects/:id with no membership check'
			);
			const stepTwo = report.indexOf(
				'handler forwards the route id to the service'
			);
			const stepThree = report.indexOf('service exports any project id');
			expect(stepOne).toBeGreaterThan(-1);
			expect(stepTwo).toBeGreaterThan(stepOne);
			expect(stepThree).toBeGreaterThan(stepTwo);
		});

		it('omits every evidence-context label when optional fields are absent', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						evidence: [
							{
								type: 'code',
								description: 'Project id used without membership check.',
							},
						],
					},
				])
			);

			expect(report).not.toContain('#### Evidence Context:');
			expect(report).not.toContain('**Source:**');
			expect(report).not.toContain('**Sink:**');
			expect(report).not.toContain('#### Attack Path:');
			expect(report).toContain(
				'- [code] Project id used without membership check.'
			);
		});

		it('ignores blank optional values and non-positive or non-finite lines', () => {
			const blank = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						source: '   ',
						sink: '',
						attackPath: ['', '   '],
						evidence: [
							{
								type: 'code',
								description: 'Only a description survives.',
								file: '   ',
								line: 0,
							},
						],
					},
				])
			);

			expect(blank).not.toContain('#### Evidence Context:');
			expect(blank).not.toContain('**Source:**');
			expect(blank).not.toContain('**Sink:**');
			expect(blank).not.toContain('#### Attack Path:');
			expect(blank).toContain('- [code] Only a description survives.');

			const nonFinite = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						evidence: [
							{
								type: 'code',
								description: 'Rejected line numbers.',
								file: 'src/a.ts',
								line: Number.NaN,
							},
						],
					},
				])
			);

			expect(nonFinite).toContain(
				'- [code] `src/a.ts` — Rejected line numbers.'
			);
		});

		it('keeps hostile markdown-like values inside single-line code spans', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						source: 'line one\n## Injected Heading',
						sink: '<img src=x onerror=alert(1)>',
						attackPath: ['| col | col |', '[click](https://evil.example)'],
						evidence: [
							{
								type: 'code',
								description: 'Payload evidence.',
								file: 'a`b\n### Deep Heading',
								line: 7,
							},
						],
					},
				])
			);

			expect(report).toContain('`line one ## Injected Heading`');
			expect(report).not.toMatch(/^#{1,6} .*Injected Heading/m);
			expect(report).not.toMatch(/^#{1,6} .*Deep Heading/m);
			expect(report).toContain('`<img src=x onerror=alert(1)>`');
			expect(report).toContain('`| col | col |`');
			expect(report).toContain('`[click](https://evil.example)`');
			// A backtick inside the value widens the fence so it cannot close early.
			expect(report).toContain('``a`b ### Deep Heading:7``');

			for (const payload of [
				'<img src=x onerror=alert(1)>',
				'| col | col |',
				'[click](https://evil.example)',
			]) {
				for (const line of report.split('\n')) {
					let index = line.indexOf(payload);
					while (index !== -1) {
						expect(line.slice(0, index).endsWith('`')).toBe(true);
						expect(line.slice(index + payload.length).startsWith('`')).toBe(
							true
						);
						index = line.indexOf(payload, index + 1);
					}
				}
			}
		});

		it('keeps hostile title, classification, and remediation prose inert', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						title: 'Injected title\n## Sub Heading',
						cwe: 'CWE-1\n## CWE Heading',
						owasp: 'A03:2021 | injected | row',
						remediation:
							'Fix it\n\n## Remediation Heading\n<script>alert(1)</script>\n- injected list item',
					},
				])
			);

			// Embedded newlines collapse, so each injected heading stays inline
			// on the finding's own line instead of opening a heading block.
			expect(report).toContain('### 1. Injected title \\#\\# Sub Heading');
			for (const heading of [
				'Sub Heading',
				'CWE Heading',
				'Remediation Heading',
			]) {
				expect(report).toContain(`\\#\\# ${heading}`);
				expect(report).not.toMatch(
					new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'm')
				);
			}
			expect(report).not.toContain('<script>');
			expect(report).toContain('&lt;script&gt;');
			expect(report).not.toContain('| injected | row');
			expect(report).toContain('\\| injected \\| row');
			// The overridden classification collapses to one line; the injected
			// heading markers are escaped rather than opening a heading block.
			expect(report).toContain('**CWE / OWASP:** CWE-1 \\#\\# CWE Heading');
		});

		it('neutralizes a leading list marker in remediation prose', () => {
			const unordered = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						remediation: '- injected list item',
					},
				])
			);
			expect(unordered).toContain('\\- injected list item');
			expect(unordered).not.toMatch(/^- injected list item/m);
			expect(unordered).not.toMatch(/^\s*-\s+injected list item/m);

			const ordered = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						remediation: '1. injected ordered item',
					},
				])
			);
			expect(ordered).toContain('1\\. injected ordered item');
			expect(ordered).not.toMatch(/^\s*1\.\s+injected ordered item/m);

			const plus = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						remediation: '+ injected plus item',
					},
				])
			);
			expect(plus).toContain('\\+ injected plus item');
			expect(plus).not.toMatch(/^\s*\+\s+injected plus item/m);
		});

		it('neutralizes each leading list marker in a single remediation', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						remediation: '- unordered\n1. ordered\n+ plus',
					},
				])
			);

			expect(report).toContain('\\- unordered 1. ordered + plus');
			for (const pattern of [
				/^\s*[-+]\s+unordered/m,
				/^\s*\d+\.\s+ordered/m,
				/^\s*[-+]\s+plus/m,
			]) {
				expect(report).not.toMatch(pattern);
			}
		});

		it('keeps hostile evidence descriptions and locations inert', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						evidence: [
							{
								type: 'code',
								description:
									'Desc\n## Evidence Heading\n[click](https://evil.example)\n| col | col |\n<img src=x onerror=alert(1)>',
							},
							{
								type: 'dataflow',
								description: 'Location with backticks.',
								file: 'a`b\n## Location Heading',
								line: 7,
							},
						],
					},
				])
			);

			expect(report).not.toMatch(
				/^#{1,6} .*(Evidence Heading|Location Heading)/m
			);
			expect(report).not.toContain('[click](https://evil.example)');
			expect(report).toContain('\\[click\\]\\(https\\://evil\\.example\\)');
			expect(report).not.toContain('| col | col |');
			expect(report).toContain('\\| col \\| col \\|');
			expect(report).not.toContain('<img src=x');
			expect(report).toContain('&lt;img src=x onerror=alert\\(1\\)&gt;');
			// Location keeps the variable-length fence for embedded backtick runs.
			expect(report).toContain('``a`b ## Location Heading:7``');
		});

		it('neutralizes a bare URL so it cannot autolink', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						evidence: [
							{
								type: 'code',
								description: 'See https://evil.example for the payload.',
							},
						],
						remediation: 'Do not fetch https://evil.example:8080/steal.',
					},
				])
			);

			// The colon is escaped, so no `scheme://` sequence survives to
			// trigger GFM autolinking in either prose field; the domain dot is
			// escaped too, so no bare-domain autolink can trigger either.
			expect(report).not.toContain('https://');
			expect(report).toContain('https\\://evil\\.example');
			expect(report).toContain('https\\://evil\\.example\\:8080/steal.');
		});

		it('neutralizes bare www and email autolinks across prose fields', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						title: 'Visit www.example.com/path for details',
						cwe: 'CWE-79 reachable via www.example.com/path',
						remediation: 'Email attacker@example.com immediately.',
						evidence: [
							{
								type: 'code',
								description:
									'Contact attacker@example.com or browse www.example.com/path.',
							},
						],
					},
				])
			);

			// GFM's bare-URL extension requires an unescaped first domain dot,
			// so `www.` followed by a letter can no longer appear.
			expect(report).not.toMatch(/www\.[a-zA-Z]/);
			expect(report).not.toContain('www.example.com/path');
			// The email extension needs a literal `@`; the escaped at-sign and
			// domain dots leave no address-shaped run behind.
			expect(report).not.toContain('attacker@example.com');
			expect(report).not.toMatch(
				/[A-Za-z0-9._%+-]@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
			);

			// Escapes are invisible in rendered Markdown, so the text stays readable.
			expect(report).toContain('www\\.example\\.com/path');
			expect(report).toContain('attacker\\@example\\.com');
		});

		it('still redacts secrets found in evidence-context fields', () => {
			const report = buildFullAuditReport(
				auditOptions([
					{
						...sampleFinding,
						source: 'process.env.GITHUB_TOKEN',
						sink: 'fetch("https://api.example.com", { headers: { Authorization: "Bearer ghp_1234567890abcdef1234567890abcdef" } })',
						attackPath: ['token ghp_1234567890abcdef1234567890abcdef leaks'],
					},
				])
			);

			expect(report).not.toContain('ghp_1234567890abcdef1234567890abcdef');
			expect(report).toContain('[REDACTED_GITHUB_TOKEN]');
		});
	});
});
