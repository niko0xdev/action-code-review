import { describe, expect, it } from 'vitest';
import { deduplicateFindings } from '../../src/security/findings/dedupe.js';
import { computeFindingFingerprint } from '../../src/security/findings/fingerprint.js';
import type { SecurityFinding } from '../../src/security/types.js';

describe('FingerprintAndDeduplication', () => {
	it('produces stable fingerprint regardless of line number changes', () => {
		const f1 = {
			title: 'SQL Injection in Query Builder',
			file: 'src/db/users.ts',
			startLine: 45,
			cwe: 'CWE-89',
			sink: 'db.query(rawSql)',
		};
		const f2 = {
			title: 'SQL Injection in Query Builder',
			file: 'src/db/users.ts',
			startLine: 120, // Line shifted in commit
			cwe: 'CWE-89',
			sink: 'db.query(rawSql)',
		};

		const fp1 = computeFindingFingerprint(f1, 'owner/repo');
		const fp2 = computeFindingFingerprint(f2, 'owner/repo');

		expect(fp1).toBe(fp2);
	});

	it('produces different fingerprints for different files or vulnerabilities', () => {
		const f1 = {
			title: 'SQL Injection in Query Builder',
			file: 'src/db/users.ts',
			cwe: 'CWE-89',
		};
		const f2 = {
			title: 'SQL Injection in Query Builder',
			file: 'src/db/orders.ts',
			cwe: 'CWE-89',
		};
		const f3 = {
			title: 'Command Injection in Runner',
			file: 'src/db/users.ts',
			cwe: 'CWE-78',
		};

		const fp1 = computeFindingFingerprint(f1, 'repo');
		const fp2 = computeFindingFingerprint(f2, 'repo');
		const fp3 = computeFindingFingerprint(f3, 'repo');

		expect(fp1).not.toBe(fp2);
		expect(fp1).not.toBe(fp3);
	});

	it('deduplicates findings with the same fingerprint and preserves highest severity/confidence', () => {
		const fp = computeFindingFingerprint(
			{
				title: 'Insecure Direct Object Reference',
				file: 'src/api/user.ts',
				cwe: 'CWE-639',
			},
			'repo'
		);

		const candidateScanner: SecurityFinding = {
			id: 'scanner-1',
			fingerprint: fp,
			title: 'Insecure Direct Object Reference',
			severity: 'medium',
			confidence: 'medium',
			status: 'candidate',
			file: 'src/api/user.ts',
			startLine: 30,
			evidence: [
				{
					type: 'scanner',
					description: 'Scanner detected unauthenticated user lookup',
				},
			],
			exploitability: 'likely',
			scannerSources: ['semgrep'],
		};

		const candidatePi: SecurityFinding = {
			id: 'pi-1',
			fingerprint: fp,
			title: 'Insecure Direct Object Reference',
			severity: 'high',
			confidence: 'confirmed',
			status: 'validated',
			file: 'src/api/user.ts',
			startLine: 30,
			evidence: [
				{
					type: 'reasoning',
					description:
						'User ID taken directly from params without tenancy check',
				},
			],
			exploitability: 'confirmed',
			remediation: 'Check user organization ID match before returning record',
			scannerSources: ['pi-security'],
		};

		const deduped = deduplicateFindings([candidateScanner, candidatePi]);

		expect(deduped).toHaveLength(1);
		const merged = deduped[0];
		expect(merged.severity).toBe('high');
		expect(merged.confidence).toBe('confirmed');
		expect(merged.status).toBe('validated');
		expect(merged.scannerSources).toContain('semgrep');
		expect(merged.scannerSources).toContain('pi-security');
		expect(merged.evidence).toHaveLength(2);
		expect(merged.remediation).toContain('organization ID');
	});
});
