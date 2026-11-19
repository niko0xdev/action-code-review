import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateSarif } from '../../src/security/sarif/sarif-generator.js';
import type { SecurityFinding } from '../../src/security/types.js';

describe('SarifGeneration', () => {
	it('reports the package release version without changing the SARIF schema', () => {
		const { version } = JSON.parse(
			readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
		);
		const sarif = JSON.parse(generateSarif([]));
		expect(sarif.runs[0].tool.driver.version).toBe(version);
		expect(sarif.version).toBe('2.1.0');
	});

	it('generates valid SARIF v2.1.0 JSON format', () => {
		const findings: SecurityFinding[] = [
			{
				id: 'sec-1',
				fingerprint: 'abcd1234efgh5678',
				title: 'SQL Injection in Repository',
				severity: 'high',
				confidence: 'confirmed',
				status: 'validated',
				category: 'security',
				cwe: 'CWE-89',
				owasp: 'A03:2021-Injection',
				file: 'src/db/repo.ts',
				startLine: 42,
				endLine: 45,
				evidence: [
					{
						type: 'code',
						description:
							'Unescaped user input interpolated into SQL query string',
					},
				],
				exploitability: 'confirmed',
				remediation: 'Use parameterized queries ($1, ?)',
			},
		];

		const sarifStr = generateSarif(findings);
		expect(sarifStr).toContain('"version": "2.1.0"');

		const sarif = JSON.parse(sarifStr);
		expect(sarif.runs).toHaveLength(1);
		const run = sarif.runs[0];
		expect(run.tool.driver.name).toBe('action-code-review');
		expect(run.results).toHaveLength(1);

		const result = run.results[0];
		expect(result.ruleId).toBe('CWE-89');
		expect(result.level).toBe('error');
		expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
			'src/db/repo.ts'
		);
		expect(result.locations[0].physicalLocation.region.startLine).toBe(42);
		expect(result.properties.fingerprint).toBe('abcd1234efgh5678');
	});

	it('redacts secrets inside generated SARIF messages', () => {
		const findings: SecurityFinding[] = [
			{
				id: 'sec-2',
				fingerprint: 'fp-secret',
				title: 'Hardcoded Secret',
				severity: 'critical',
				confidence: 'confirmed',
				status: 'validated',
				file: 'src/secret.ts',
				startLine: 1,
				evidence: [
					{
						type: 'code',
						description:
							'Found exposed token ghp_1234567890abcdef1234567890abcdef in source',
					},
				],
				exploitability: 'confirmed',
			},
		];

		const sarifStr = generateSarif(findings);
		expect(sarifStr).not.toContain('ghp_1234567890abcdef');
		expect(sarifStr).toContain('[REDACTED_GITHUB_TOKEN]');
	});
});

it('redacts structured SARIF fields as well as messages', () => {
	const token = `ghp_${'A'.repeat(36)}`;
	const finding: SecurityFinding = {
		id: 'synthetic',
		fingerprint: token,
		title: token,
		severity: 'high',
		confidence: 'high',
		status: 'validated',
		cwe: token,
		owasp: token,
		file: `src/${token}.ts`,
		startLine: 1,
		evidence: [{ type: 'code', description: token }],
		exploitability: 'likely',
		remediation: token,
	};
	const output = generateSarif([finding], token, token);
	expect(output).not.toContain(token);
	expect(
		JSON.parse(output).runs[0].results[0].locations[0].physicalLocation
			.artifactLocation.uri
	).toContain('[REDACTED_GITHUB_TOKEN]');
});

it('keeps ordinary file paths intact while redacting secrets', () => {
	const finding: SecurityFinding = {
		id: 'path',
		fingerprint: 'fp-path',
		title: 'Issue',
		severity: 'high',
		confidence: 'high',
		status: 'validated',
		file: 'src/task-runner-service-impl.ts',
		startLine: 3,
		evidence: [{ type: 'code', description: 'evidence' }],
		exploitability: 'likely',
		remediation: 'fix',
	};
	const output = generateSarif([finding]);
	expect(
		JSON.parse(output).runs[0].results[0].locations[0].physicalLocation
			.artifactLocation.uri
	).toBe('src/task-runner-service-impl.ts');
});
