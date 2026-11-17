import { describe, expect, it } from 'vitest';
import { deduplicateFindings } from '../../src/security/findings/dedupe.js';
import type { SecurityFinding } from '../../src/security/types.js';

const finding: SecurityFinding = {
	id: 'one',
	fingerprint: 'same-rule',
	title: 'Injection',
	severity: 'high',
	confidence: 'high',
	status: 'candidate',
	file: 'src/auth.ts',
	startLine: 1,
	source: 'request.a',
	sink: 'query',
	exploitability: 'likely',
	evidence: [
		{
			type: 'code',
			description: 'Source reaches query',
			file: 'src/auth.ts',
			line: 1,
		},
	],
};

describe('occurrence deduplication', () => {
	it.each([
		{ startLine: 100 },
		{ endLine: 2 },
		{ file: 'src/Auth.ts' },
		{ source: 'request.b' },
		{ sink: 'otherQuery' },
	])('preserves a distinct occurrence: %j', (change) => {
		expect(
			deduplicateFindings([finding, { ...finding, ...change }])
		).toHaveLength(2);
	});

	it('merges the same occurrence without mutating input evidence', () => {
		const first = structuredClone(finding);
		const second = {
			...structuredClone(finding),
			evidence: [
				{
					type: 'code' as const,
					description: 'Source reaches query',
					file: 'src/source.ts',
					line: 50,
				},
			],
		};
		const result = deduplicateFindings([first, second]);
		expect(result).toHaveLength(1);
		expect(result[0].evidence).toHaveLength(2);
		expect(first).toEqual(finding);
	});
});
