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
		replacement: finding.replacement
			? mdSafe(finding.replacement)
			: finding.replacement,
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

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const CATEGORIES = Object.keys(CATEGORY_LABEL) as Array<
	keyof typeof CATEGORY_LABEL
>;

type SummaryResult = {
	risk: RiskLevel;
	counts: { critical: number; high: number; medium: number; low: number };
	filesReviewed: string[];
	summary?: string;
	findings?: Finding[];
	model?: string;
	durationMs?: number;
	filesTotal?: number;
	filesExcluded?: number;
};

function hasBlockingFindings(
	findings: Finding[],
	counts: SummaryResult['counts']
): boolean {
	return findings.length > 0
		? findings.some((finding) => finding.severity !== 'low')
		: counts.critical + counts.high + counts.medium > 0;
}

export function formatDecisionBanner(
	risk: RiskLevel,
	findings: Finding[] = [],
	counts: SummaryResult['counts'] = { critical: 0, high: 0, medium: 0, low: 0 }
): string {
	if (
		risk === 'critical' ||
		findings.some((finding) => finding.severity === 'critical')
	)
		return '> 🚨 **CRITICAL — merge blocked**';
	return hasBlockingFindings(findings, counts)
		? '> ⚠️ **CHANGES REQUESTED**'
		: '> ✨ **APPROVED**';
}

export function buildChecksTable(
	findings: Finding[],
	_counts: SummaryResult['counts']
): string[] {
	const categoryCounts = new Map<string, number>();
	for (const finding of findings)
		categoryCounts.set(
			finding.category,
			(categoryCounts.get(finding.category) ?? 0) + 1
		);
	return [
		'## Checks performed',
		'',
		'| Check | Status |',
		'|-------|:------:|',
		...CATEGORIES.map((category) => {
			const count = categoryCounts.get(category) ?? 0;
			return `| ${count ? '❌' : '✅'} ${CATEGORY_LABEL[category]} | ${count ? `${count} issue${count === 1 ? '' : 's'}` : 'passed'} |`;
		}),
	];
}

function formatDuration(durationMs: number | undefined): string {
	if (durationMs === undefined) return 'n/a';
	const seconds = durationMs / 1000;
	return `${Number(seconds.toFixed(1))}s`;
}

function findingLines(findings: Finding[] = []): string[] {
	if (!findings.length) return ['## Top findings', '', 'No findings.'];
	const sorted = [...findings]
		.sort(
			(a, b) =>
				SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
				b.confidence - a.confidence
		)
		.slice(0, 5);
	return [
		'## Top findings',
		'',
		...sorted.flatMap((finding) => {
			const icon = SEVERITY_ICON[finding.severity] ?? '•';
			const lines = [
				`- ${icon} **${finding.severity.toUpperCase()}** \`${mdSafe(finding.path)}:${finding.line}\` — ${mdSafe(finding.title)} (confidence ${finding.confidence.toFixed(2)})`,
				`  > ${mdSafe(finding.description).split('\n')[0] || 'No description provided.'}`,
			];
			if (finding.suggestion)
				lines.push(`  > **Suggested fix:** ${mdSafe(finding.suggestion)}`);
			return lines;
		}),
	];
}

/** Render rich PR summary while keeping the legacy heading recognizable. */
export function buildSummaryBody(result: SummaryResult): string {
	const findings = result.findings ?? [];
	const blocking = hasBlockingFindings(findings, result.counts);
	const reviewed = result.filesReviewed.length;
	const excluded =
		result.filesExcluded ??
		Math.max((result.filesTotal ?? reviewed) - reviewed, 0);
	const total = result.filesTotal ?? reviewed + excluded;
	const filesLine =
		result.filesTotal !== undefined || result.filesExcluded !== undefined
			? `**Files reviewed:** ${reviewed} of ${total} (${excluded} excluded by filter)`
			: `**Files reviewed:** ${reviewed}`;
	const decision = blocking
		? result.risk === 'critical' ||
			findings.some((finding) => finding.severity === 'critical')
			? '❌ **Changes requested** — critical findings block merge.'
			: `❌ **Changes requested** — ${findings.filter((finding) => finding.severity !== 'low').length || result.counts.critical + result.counts.high + result.counts.medium} blocking finding(s). Please address before merge.`
		: '✅ **All clear** — no blocking findings. Approving.';
	const footer = footerLine(
		result.model ?? process.env.OPENAI_API_MODEL ?? 'unknown'
	);
	const lines = [
		'# 🤖 AI Code Review',
		'',
		formatDecisionBanner(result.risk, findings, result.counts),
		'',
		`**Risk:** ${RISK_LABEL[result.risk]}`,
		`**Model:** \`${mdSafe(result.model ?? process.env.OPENAI_API_MODEL ?? 'unknown')}\``,
		`**Duration:** ${formatDuration(result.durationMs)}`,
		filesLine,
		`**Reviewed files:** ${reviewed}`,
		`**Severity counts:** Critical: ${result.counts.critical} · High: ${result.counts.high} · Medium: ${result.counts.medium} · Low: ${result.counts.low}`,
	];
	if (result.summary) lines.push('', result.summary);
	lines.push(
		'',
		'## Findings',
		'',
		'| Severity | Count | Status |',
		'|----------|------:|:------:|',
		`| 🚨 Critical | ${result.counts.critical} | ${result.counts.critical ? '❌' : '✅'} |`,
		`| 🔥 High | ${result.counts.high} | ${result.counts.high ? '❌' : '✅'} |`,
		`| ⚠️ Medium | ${result.counts.medium} | ${result.counts.medium ? '❌' : '✅'} |`,
		`| ✅ Low | ${result.counts.low} | ${result.counts.low ? '❌' : '✅'} |`,
		'',
		'## Decision',
		'',
		decision,
		'',
		...findingLines(findings),
		'',
		...buildChecksTable(findings, result.counts),
		'',
		'---',
		footer
	);
	return lines.join('\n');
}

function footerLine(model: string): string {
	const repository = process.env.GITHUB_REPOSITORY;
	const runId = process.env.GITHUB_RUN_ID;
	const run =
		repository && runId
			? `[view logs](https://github.com/${repository}/actions/runs/${runId})`
			: 'view logs';
	return `🤖 Generated by [action-code-review](https://github.com/niko0xdev/action-code-review) using \`${mdSafe(model)}\` · ${run}`;
}
