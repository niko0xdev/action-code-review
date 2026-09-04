import { describe, expect, it } from 'vitest';
import { normalizeSecurityFinding } from '../../src/security/findings/normalizer.js';

describe('FindingNormalizer', () => {
	it('normalizes valid raw finding object', () => {
		const raw = {
			title: 'Unauthenticated Admin Endpoint',
			severity: 'critical',
			confidence: 'high',
			cwe: 'CWE-306',
			file: 'src/admin/dashboard.ts',
			startLine: 15,
			evidence: [
				{ type: 'code', description: 'Missing auth middleware on admin route' },
			],
			exploitability: 'likely',
			remediation: 'Attach requireAdminAuth middleware',
		};

		const normalized = normalizeSecurityFinding(raw, 'org/repo');
		expect(normalized).not.toBeNull();
		expect(normalized?.title).toBe('Unauthenticated Admin Endpoint');
		expect(normalized?.severity).toBe('critical');
		expect(normalized?.confidence).toBe('high');
		expect(normalized?.cwe).toBe('CWE-306');
		expect(normalized?.file).toBe('src/admin/dashboard.ts');
		expect(normalized?.startLine).toBe(15);
		expect(normalized?.evidence).toHaveLength(1);
	});

	it('handles numeric confidence and line string coercions', () => {
		const raw = {
			title: 'Potential SSRF in Proxy',
			confidence: 0.9,
			severity: 'HIGH',
			path: './src/proxy.ts',
			line: 88,
			description: 'Unchecked url passed to http.get',
		};

		const normalized = normalizeSecurityFinding(
			raw,
			'org/repo',
			'test-scanner'
		);
		expect(normalized).not.toBeNull();
		expect(normalized?.confidence).toBe('high');
		expect(normalized?.severity).toBe('high');
		expect(normalized?.file).toBe('src/proxy.ts');
		expect(normalized?.startLine).toBe(88);
		expect(normalized?.scannerSources).toContain('test-scanner');
		expect(normalized?.evidence[0].description).toBe(
			'Unchecked url passed to http.get'
		);
	});

	it('rejects invalid or empty objects', () => {
		expect(normalizeSecurityFinding(null)).toBeNull();
		expect(normalizeSecurityFinding(undefined)).toBeNull();
		expect(normalizeSecurityFinding({})).toBeNull();
		expect(normalizeSecurityFinding({ title: '' })).toBeNull();
	});

	it('defaults unknown severities to medium', () => {
		const raw = {
			title: 'Unknown issue',
			severity: 'catastrophic',
		};
		const normalized = normalizeSecurityFinding(raw);
		expect(normalized?.severity).toBe('medium');
	});
});
