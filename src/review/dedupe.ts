import { createHash } from 'node:crypto';
import type { Finding } from '../types/finding.js';

export function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function dedupeKey(finding: Finding): string {
	return [
		finding.path,
		finding.line,
		finding.category,
		finding.ruleId?.trim() ||
			normalizeTitle(finding.title).split(' ').slice(0, 4).join(' '),
	].join('|');
}

export function dedupeFindings(findings: Finding[]): Finding[] {
	const best = new Map<string, Finding>();
	for (const finding of findings) {
		const key = dedupeKey(finding);
		const existing = best.get(key);
		if (!existing || finding.confidence > existing.confidence) {
			best.set(key, finding);
		}
	}
	return [...best.values()];
}

export function legacySeverity(severity: Finding['severity']): string {
	return severity === 'medium' ? 'low' : severity;
}

export function commentIdentityBody(finding: Finding): string {
	const icons: Record<string, string> = {
		critical: '🚨',
		high: '🔥',
		medium: '⚠️',
		low: '✅',
	};
	const categories: Record<string, string> = {
		correctness: 'Correctness',
		security: 'Security',
		regression: 'Regression',
		'error-handling': 'Error handling',
		'data-integrity': 'Data integrity',
		concurrency: 'Concurrency',
		performance: 'Performance',
		maintainability: 'Maintainability',
		testing: 'Testing',
		compatibility: 'Compatibility',
	};
	const parts = [
		`${icons[finding.severity] ?? '•'} ${finding.severity.toUpperCase()} · ${categories[finding.category] ?? finding.category}`,
		`_Severity:_ ${legacySeverity(finding.severity)}`,
		finding.title,
		finding.description,
		finding.impact ? `**Impact:** ${finding.impact}` : '',
		finding.suggestion && !finding.replacement
			? `**Suggestion:** ${finding.suggestion}`
			: '',
	];
	if (
		finding.replacement &&
		finding.confidence >= 0.85 &&
		finding.replacement.split('\n').length <= 10 &&
		finding.replacement.length <= 400
	) {
		parts.push(['```suggestion', finding.replacement, '```'].join('\n'));
	}
	return parts.filter(Boolean).join('\n\n').trim();
}

export function normalizeCommentId(finding: Finding): string {
	return createHash('sha256')
		.update(
			[
				finding.path,
				finding.line.toString(),
				commentIdentityBody(finding),
				finding.ruleId?.trim() ?? '',
			].join('|')
		)
		.digest('hex')
		.slice(0, 12);
}
