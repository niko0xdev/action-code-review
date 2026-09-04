import { describe, expect, it } from 'vitest';
import {
	capFindings,
	computeCounts,
	riskFromFindings,
} from '../../src/review/severity.js';
import type { Finding, Severity } from '../../src/types/finding.js';

function finding(severity: Severity, confidence: number): Finding {
	return {
		severity,
		confidence,
		category: 'correctness',
		path: 'src/a.ts',
		line: 1 + Math.floor(confidence * 100),
		title: `t-${severity}-${confidence}`,
		description: 'd',
		impact: 'i',
	};
}

describe('capFindings (spec §19)', () => {
	it('keeps everything under the limits', () => {
		const findings = [
			finding('critical', 0.9),
			finding('high', 0.9),
			finding('medium', 0.9),
			finding('low', 0.9),
		];
		expect(capFindings(findings)).toHaveLength(4);
	});

	it('truncates per severity at the caps', () => {
		const findings = Array.from({ length: 7 }, () => finding('low', 0.9));
		expect(capFindings(findings)).toHaveLength(5); // low cap = 5
	});

	it('enforces the overall cap prioritizing by severity then confidence', () => {
		const findings = [
			...Array.from({ length: 8 }, () => finding('medium', 0.5)),
			...Array.from({ length: 10 }, (_, i) => finding('high', 0.95 - i * 0.01)),
			...Array.from({ length: 9 }, () => finding('critical', 0.99)),
		];
		const capped = capFindings(findings);
		expect(capped).toHaveLength(20); // overall cap
		expect(capped.filter((f) => f.severity === 'critical')).toHaveLength(9);
		expect(capped.filter((f) => f.severity === 'high')).toHaveLength(10);
		expect(capped.filter((f) => f.severity === 'medium')).toHaveLength(1);
	});

	it('prefers higher confidence within a severity bucket', () => {
		const findings = [
			finding('low', 0.3),
			finding('low', 0.8),
			finding('low', 0.5),
			finding('low', 0.9),
			finding('low', 0.6),
			finding('low', 0.4),
		];
		const capped = capFindings(findings);
		expect(
			capped
				.map((f) => f.confidence)
				.sort()
				.reverse()
		).toEqual([0.9, 0.8, 0.6, 0.5, 0.4]);
	});
});

describe('computeCounts', () => {
	it('counts each severity bucket', () => {
		const counts = computeCounts([
			finding('critical', 0.9),
			finding('high', 0.9),
			finding('high', 0.8),
			finding('low', 0.7),
		]);
		expect(counts).toEqual({ critical: 1, high: 2, medium: 0, low: 1 });
	});
});

describe('riskFromFindings', () => {
	it('maps to none when empty', () => {
		expect(riskFromFindings([])).toBe('none');
	});

	it('escalates with the most severe finding', () => {
		expect(riskFromFindings([finding('critical', 0.9)])).toBe('critical');
		expect(
			riskFromFindings([finding('medium', 0.9), finding('low', 0.9)])
		).toBe('medium');
	});

	it('treats multiple high findings as critical risk', () => {
		expect(
			riskFromFindings([finding('high', 0.9), finding('high', 0.85)])
		).toBe('critical');
	});
});
