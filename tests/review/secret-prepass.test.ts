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

	it('keeps the deterministic finding when the model reported that line', () => {
		const model: Finding = { ...secret, ruleId: undefined, confidence: 0.9 };
		const r = result([model]);
		mergeSecretFindings(r, [secret]);
		expect(r.findings).toHaveLength(1);
		expect(r.findings[0].ruleId).toBe('secret-scan/sec-rule-gh-token');
		expect(r.diagnostics?.secretScanFindings).toBe(1);
	});

	it('cannot be suppressed by a model finding on the same line', () => {
		const model: Finding = {
			...secret,
			ruleId: undefined,
			confidence: 0.9,
			title: 'Nothing to see here',
		};
		const r = result([model]);
		mergeSecretFindings(r, [secret]);
		expect(r.findings).toHaveLength(1);
		expect(r.findings[0].title).toContain('added in this change');
		expect(r.counts.critical).toBe(1);
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

describe('secret pre-pass review findings (20/11/2026)', () => {
	const gh = `ghp_${'A1b2C3d4'.repeat(5)}`;
	const added = (lines: string[]) =>
		`@@ -1,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;

	it('keeps a model finding on a line beyond the ten-finding cap', () => {
		const secrets = scanReviewSecrets([
			file(
				'keys.env',
				added(Array.from({ length: 12 }, (_, i) => `K${i}=${gh}`))
			),
		]);
		const model: Finding = {
			...secrets[11],
			ruleId: undefined,
			title: 'Hard-coded token',
		};
		const r = result([model]);
		mergeSecretFindings(r, secrets);
		expect(r.findings.some((f) => f.line === 12)).toBe(true);
		expect(r.diagnostics?.secretScanFindings).toBe(10);
	});

	it('keeps the higher severity when it replaces a model finding', () => {
		const slack = `xoxb-${'1'.repeat(11)}-${'2'.repeat(11)}-abc`;
		const [secret] = scanReviewSecrets([
			file('a.ts', added([`t = "${slack}"`])),
		]);
		expect(secret.severity).toBe('high');
		const r = result([{ ...secret, severity: 'critical', ruleId: undefined }]);
		mergeSecretFindings(r, [secret]);
		expect(r.findings).toHaveLength(1);
		expect(r.findings[0].severity).toBe('critical');
	});

	it('does not flag documentation examples, kebab-case names, or allow-listed lines', () => {
		const findings = scanReviewSecrets([
			file(
				'notes.md',
				added([
					'AKIAIOSFODNN7EXAMPLE',
					'"name": "sk-react-loading-spinner-component"',
					'.sk-folding-cube-rotate-angle-delay { }',
					'"-----BEGIN PRIVATE KEY-----" // secret-scan: allow',
					`token = "${gh}" # pragma: allowlist secret`,
				])
			),
		]);
		expect(findings).toEqual([]);
	});

	it('still flags real-looking keys', () => {
		const findings = scanReviewSecrets([
			file(
				'a.ts',
				added([
					'const k = "sk-proj-1234567890abcdef1234567890abcdef";',
					'AKIAZ7Q2X4C6V8B0N1M3',
				])
			),
		]);
		expect(findings.map((f) => f.ruleId)).toEqual([
			'secret-scan/sec-rule-openai-key',
			'secret-scan/sec-rule-aws-key',
		]);
	});

	it('takes the rule id from the scanner, whatever the file name', () => {
		const [secret] = scanReviewSecrets([file('token', added([`x=${gh}`]))]);
		expect(secret.ruleId).toBe('secret-scan/sec-rule-gh-token');
	});
});
