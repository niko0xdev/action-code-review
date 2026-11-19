import { describe, expect, it } from 'vitest';
import {
	mergeSecretFindings,
	scanReviewSecrets,
} from '../../src/review/secret-prepass.js';
import { scanSecretsInDiff } from '../../src/security/scanners/secret-scanner.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';

const token = `ghp_${'A1b2C3d4'.repeat(5)}`;
const file = (filename: string, patch?: string) => ({
	filename,
	status: 'modified',
	additions: 1,
	deletions: 0,
	changes: 1,
	patch,
});

function result(findings: Finding[] = []): ReviewResult {
	return {
		findings,
		summary: '',
		risk: 'low',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: [],
	};
}

describe('scanReviewSecrets', () => {
	it('turns added credentials into anchored, value-free review findings', () => {
		const findings = scanReviewSecrets([
			file(
				'src/config.ts',
				`@@ -1,1 +1,2 @@\n const a = 1;\n+const t = "${token}";`
			),
			file('docs/setup.md', `@@ -4,0 +5,1 @@\n+export GH=${token}`),
			file('assets/logo.png'),
		]);
		expect(
			findings.map((f) => [f.path, f.line, f.severity, f.category])
		).toEqual([
			['src/config.ts', 2, 'critical', 'security'],
			['docs/setup.md', 5, 'critical', 'security'],
		]);
		expect(findings[0].confidence).toBe(1);
		expect(findings[0].ruleId).toBe('secret-scan/sec-rule-gh-token');
		expect(JSON.stringify(findings)).not.toContain(token);
	});

	it('ignores removed lines and keeps line numbers after a missing-newline marker', () => {
		const patch = [
			'@@ -1,2 +1,3 @@',
			`-const old = "${token}";`,
			' const a = 1;',
			'\\ No newline at end of file',
			`+const t = "${token}";`,
		].join('\n');
		expect(scanReviewSecrets([file('a.ts', patch)]).map((f) => f.line)).toEqual(
			[2]
		);
		expect(scanSecretsInDiff([{ filename: 'a.ts', patch }])[0].startLine).toBe(
			2
		);
	});
});

describe('mergeSecretFindings', () => {
	const secret: Finding = {
		...scanReviewSecrets([
			file('a.ts', `@@ -1,0 +1,1 @@\n+const t = "${token}";`),
		])[0],
	};

	it('adds secrets, recomputes counts and risk, and records the count', () => {
		const r = result();
		mergeSecretFindings(r, [secret]);
		expect(r.findings).toHaveLength(1);
		expect(r.counts.critical).toBe(1);
		expect(r.risk).toBe('critical');
		expect(r.diagnostics?.secretScanFindings).toBe(1);
	});

	it('does not duplicate a security finding the model already reported on that line', () => {
		const model: Finding = { ...secret, ruleId: undefined, confidence: 0.9 };
		const r = result([model]);
		mergeSecretFindings(r, [secret]);
		expect(r.findings).toHaveLength(1);
		expect(r.diagnostics?.secretScanFindings).toBe(0);
	});

	it('publishes at most ten secret findings', () => {
		const many = Array.from({ length: 14 }, (_, i) => ({
			...secret,
			line: i + 1,
		}));
		const r = result();
		mergeSecretFindings(r, many);
		expect(r.findings).toHaveLength(10);
	});
});

describe('secret-scan input', () => {
	it('is off by default and maps "true"', async () => {
		const { mapPrReviewInputs } = await import(
			'../../src/adapter/legacy-inputs.js'
		);
		expect(mapPrReviewInputs({}).secretScan).toBe(false);
		expect(mapPrReviewInputs({ 'secret-scan': 'true' }).secretScan).toBe(true);
	});
});
