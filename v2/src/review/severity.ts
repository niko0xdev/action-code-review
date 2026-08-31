import {
	FINDING_LIMITS,
	type Finding,
	type FindingCounts,
	type RiskLevel,
	SEVERITY_ORDER,
	type Severity,
} from '../types/finding.js';

/**
 * Severity handling (spec §19): per-severity caps plus an overall cap.
 * Overflow is resolved by severity rank first, confidence second.
 */

export function computeCounts(findings: Finding[]): FindingCounts {
	const counts: FindingCounts = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
	};
	for (const finding of findings) {
		counts[finding.severity] += 1;
	}
	return counts;
}

export function capFindings(findings: Finding[]): Finding[] {
	const perSeverity = new Map<Severity, Finding[]>();
	for (const finding of findings) {
		const bucket = perSeverity.get(finding.severity) ?? [];
		bucket.push(finding);
		perSeverity.set(finding.severity, bucket);
	}

	const kept: Finding[] = [];
	for (const [severity, bucket] of [...perSeverity.entries()].sort(
		(a, b) => SEVERITY_ORDER[b[0]] - SEVERITY_ORDER[a[0]]
	)) {
		bucket.sort((a, b) => b.confidence - a.confidence);
		kept.push(...bucket.slice(0, FINDING_LIMITS[severity]));
	}

	return kept.slice(0, FINDING_LIMITS.overall);
}

/** Overall risk from the surviving findings (spec §20/§21). */
export function riskFromFindings(findings: Finding[]): RiskLevel {
	let hasCritical = false;
	let highCount = 0;

	for (const finding of findings) {
		switch (finding.severity) {
			case 'critical':
				hasCritical = true;
				break;
			case 'high':
				highCount += 1;
				break;
			case 'medium':
			case 'low':
				break;
		}
	}

	if (hasCritical || highCount >= 2) {
		return 'critical';
	}
	if (highCount === 1) {
		return 'high';
	}
	if (findings.some((f) => f.severity === 'medium')) {
		return 'medium';
	}
	if (findings.some((f) => f.severity === 'low')) {
		return 'low';
	}
	return 'none';
}
