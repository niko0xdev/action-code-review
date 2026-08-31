import { commentIdentityBody, normalizeCommentId } from '../review/dedupe.js';
import type { Finding, RiskLevel } from '../types/finding.js';

export function mdSafe(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * Comment body rendering. Severity icons and the hidden ai-review-id
 * marker follow the legacy format (docs/v1-interface-contract.md) so
 * duplicate suppression keeps working across versions.
 */

const SEVERITY_ICON: Record<string, string> = {
	critical: '🚨',
	high: '🔥',
	medium: '⚠️',
	low: '✅',
};

const CATEGORY_LABEL: Record<string, string> = {
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

export function severityBadge(finding: Finding): string {
	const icon = SEVERITY_ICON[finding.severity] ?? '•';
	const label = finding.severity.toUpperCase();
	const category = CATEGORY_LABEL[finding.category] ?? finding.category;
	return `${icon} ${label} · ${category}`;
}

/** Full inline-comment body for a finding, ending with its id marker. */
export function buildFindingBody(finding: Finding): string {
	const safeFinding = {
		...finding,
		title: mdSafe(finding.title),
		description: mdSafe(finding.description),
		impact: mdSafe(finding.impact),
		suggestion: finding.suggestion ? mdSafe(finding.suggestion) : undefined,
		replacement: finding.replacement ? mdSafe(finding.replacement) : finding.replacement,
	};
	const body = commentIdentityBody(safeFinding);
	return `${body}\n\n<!-- ai-review-id:${normalizeCommentId(finding)} -->`;
}

const RISK_LABEL: Record<RiskLevel, string> = {
	critical: 'Critical',
	high: 'High',
	medium: 'Medium',
	low: 'Low',
	none: 'None',
};

/**
 * PR summary comment (spec §20/§21). Keeps the legacy "AI Code Review"
 * heading recognizable while adding risk + severity distribution.
 */
export function buildSummaryBody(result: {
	risk: RiskLevel;
	counts: { critical: number; high: number; medium: number; low: number };
	filesReviewed: string[];
	summary?: string;
}): string {
	const lines: string[] = [
		'# 🤖 AI Code Review',
		'',
		`**Risk:** ${RISK_LABEL[result.risk]}`,
		`**Reviewed files:** ${result.filesReviewed.length}`,
	];
	if (result.summary) {
		lines.push('', result.summary);
	}
	lines.push(
		'',
		'**Findings:**',
		`- Critical: ${result.counts.critical}`,
		`- High: ${result.counts.high}`,
		`- Medium: ${result.counts.medium}`,
		`- Low: ${result.counts.low}`
	);
	return lines.join('\n');
}
