import { commentIdentityBody, normalizeCommentId } from '../review/dedupe.js';
import { redactSecrets } from '../security/redaction/redactor.js';
import type {
	ApprovalOutcome,
	Finding,
	ReviewDiagnostics,
	RiskLevel,
	RuleCoverage,
	ToolFinding,
} from '../types/finding.js';

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

/** Full inline-comment body for a finding, ending with its id marker. */
export function buildFindingBody(finding: Finding): string {
	const safeFinding = {
		...finding,
		title: mdSafe(redactSecrets(finding.title)),
		description: mdSafe(redactSecrets(finding.description)),
		impact: mdSafe(redactSecrets(finding.impact)),
		suggestion: finding.suggestion
			? mdSafe(redactSecrets(finding.suggestion))
			: undefined,
		// Replacement is code inside a fenced suggestion block. Escaping it as
		// HTML text changes the bytes GitHub applies (e.g. `<T>` or `&&`).
		replacement: finding.replacement
			? redactSecrets(finding.replacement)
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
	filesTruncated?: boolean;
	summary?: string;
	findings?: Finding[];
	model?: string;
	durationMs?: number;
	filesTotal?: number;
	filesExcluded?: number;
	/** Files the review accepted for analysis (post-filter scope). */
	filesSelected?: number;
	toolFindings?: ToolFinding[];
	diagnostics?: ReviewDiagnostics;
	ruleCoverage?: RuleCoverage;
	reviewStatus?: 'complete' | 'incomplete' | 'failed' | 'stale';
	approval?: ApprovalOutcome;
};

function hasBlockingFindings(
	findings: Finding[],
	counts: SummaryResult['counts']
): boolean {
	return findings.length > 0
		? findings.some((finding) => finding.severity !== 'low')
		: counts.critical + counts.high + counts.medium > 0;
}

/** Files inside failed review groups: reviewed + excluded + these = total. */
function filesNotAnalyzed(result: SummaryResult): number {
	const explicit = result.diagnostics?.filesNotAnalyzed;
	if (typeof explicit === 'number' && explicit > 0) return explicit;
	const reviewed = result.filesReviewed.length;
	const selected = result.filesSelected ?? reviewed;
	return Math.max(selected - reviewed, 0);
}

/**
 * One line that answers "did this review actually run, and over what?".
 *
 * `filesSelected` is the scope the review accepted (after exclude patterns and
 * the `max-files` cap); excluded files are not missing coverage. A group failure
 * or a shortfall against that scope is reported as incomplete even when the
 * engine declared the run complete, so a partial pass can never read as full
 * coverage.
 */
export function describeReviewExecution(result: SummaryResult): string {
	const reviewed = result.filesReviewed.length;
	const selected =
		result.filesSelected ?? reviewed + (result.filesExcluded ?? 0);
	const notAnalyzed = filesNotAnalyzed(result);
	const failedGroups = result.diagnostics?.failedGroups ?? 0;
	const declared = result.reviewStatus ?? 'complete';
	const incomplete =
		declared !== 'complete' || failedGroups > 0 || notAnalyzed > 0;
	const reasons = [
		`${reviewed}/${selected} selected files analyzed`,
		failedGroups > 0
			? `${failedGroups} review group${failedGroups === 1 ? '' : 's'} failed`
			: '',
		notAnalyzed > 0
			? `${notAnalyzed} file${notAnalyzed === 1 ? '' : 's'} not analyzed`
			: '',
		declared !== 'complete' ? `status: ${declared}` : '',
	].filter(Boolean);
	return `**Review execution:** ${incomplete ? 'incomplete' : 'complete'} — ${reasons.join('; ')}`;
}

/**
 * Approval line derived from the publisher's recorded outcome. The reader
 * should never have to infer an approval from "0 findings": every state is
 * spelled out, including the repository setting that can block it.
 */
export function describeApproval(outcome: ApprovalOutcome | undefined): string {
	switch (outcome?.state) {
		case 'approved':
			return '**Approval:** submitted — GitHub approved this PR.';
		case 'not-permitted':
			return [
				'**Approval:** blocked by repository settings.',
				'Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**',
				'so the bot can submit the approval.',
				outcome.detail ? `GitHub said: ${mdSafe(outcome.detail)}.` : '',
			]
				.filter(Boolean)
				.join(' ');
		case 'failed':
			return `**Approval:** attempt failed${outcome.detail ? ` — ${mdSafe(outcome.detail)}` : ''}.`;
		case 'skipped-unresolved-threads':
			return '**Approval:** skipped — AI review threads are not all resolved yet.';
		case 'skipped-no-write-permission':
			return '**Approval:** skipped — the PR actor has no write permission.';
		default:
			return '**Approval:** not requested.';
	}
}

/**
 * Decision line for a clean review. It mirrors the recorded approval outcome
 * instead of asserting that an approval happened.
 */
function describeApprovalDecision(result: SummaryResult): string {
	switch (result.approval?.state) {
		case 'approved':
			return '✅ **All clear** — no blocking findings, and GitHub accepted the approval review.';
		case 'not-permitted':
			return '✅ **All clear** — no blocking findings. The approval review was rejected by repository settings (see Approval above).';
		case 'failed':
			return '✅ **All clear** — no blocking findings. The approval attempt failed (see Approval above).';
		case 'skipped-unresolved-threads':
			return '✅ **All clear** — no blocking findings. Approval is withheld until existing AI threads are resolved.';
		case 'skipped-no-write-permission':
			return '✅ **All clear** — no blocking findings. Approval is skipped because the PR actor lacks write permission.';
		default:
			return '✅ **All clear** — no blocking findings. No approval review was submitted.';
	}
}

export function formatDecisionBanner(
	risk: RiskLevel,
	findings: Finding[] = [],
	counts: SummaryResult['counts'] = { critical: 0, high: 0, medium: 0, low: 0 },
	reviewStatus: SummaryResult['reviewStatus'] = 'complete',
	approval?: ApprovalOutcome
): string {
	if (reviewStatus !== 'complete')
		return '> ⚠️ **REVIEW INCOMPLETE — NO APPROVAL**';
	if (
		risk === 'critical' ||
		findings.some((finding) => finding.severity === 'critical')
	)
		return '> 🚨 **CRITICAL — merge blocked**';
	if (hasBlockingFindings(findings, counts)) return '> ⚠️ **CHANGES REQUESTED**';
	switch (approval?.state) {
		case 'approved':
			return '> ✨ **APPROVED**';
		case 'not-permitted':
			return '> 🚫 **APPROVAL NOT PERMITTED** — clean review, but repository settings block GitHub Actions from approving';
		case 'failed':
			return '> ⚠️ **APPROVAL FAILED** — clean review, but the approval call did not succeed';
		default:
			return '> ✅ **NO BLOCKING FINDINGS**';
	}
}

export function buildChecksTable(
	findings: Finding[],
	_counts: SummaryResult['counts'],
	ruleCoverage?: RuleCoverage
): string[] {
	const categoryCounts = new Map<string, number>();
	for (const finding of findings)
		categoryCounts.set(
			finding.category,
			(categoryCounts.get(finding.category) ?? 0) + 1
		);
	const rulesCell = ruleCoverage
		? ruleCoverage.assessed !== undefined
			? `${ruleCoverage.assessed}/${ruleCoverage.total} assessed`
			: `${ruleCoverage.passed}/${ruleCoverage.total} passed`
		: 'N/A';
	const failedCell =
		ruleCoverage && ruleCoverage.failedRules.length > 0
			? ruleCoverage.failedRules
					.map(
						(rule) =>
							`- ${mdSafe(rule)
								.replaceAll('|', '\\|')
								.replaceAll(/[\r\n]/g, ' ')}`
					)
					.join('<br>')
			: '—';
	return [
		'## Checks performed',
		'',
		'| Check | Status | Rules | Failed rule |',
		'|-------|:------:|:-----:|-------------|',
		...CATEGORIES.map((category) => {
			const count = categoryCounts.get(category) ?? 0;
			return `| ${count ? '❌' : '✅'} ${CATEGORY_LABEL[category]} | ${count ? `${count} issue${count === 1 ? '' : 's'}` : 'passed'} | ${rulesCell} | ${failedCell} |`;
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
	const reviewStatus =
		result.reviewStatus ??
		(result.diagnostics?.failedGroups ? 'incomplete' : 'complete');
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
	const truncationNotice = result.filesTruncated
		? '\n> ⚠️ **FILE LIST TRUNCATED** — GitHub pagination reached its safety limit; this review does not cover every changed file.\n'
		: '';
	const decision =
		reviewStatus !== 'complete'
			? `⚠️ **Review incomplete** — status: ${reviewStatus}. No clean approval is implied; rerun after the failed or stale scope is fixed.`
			: blocking
				? result.risk === 'critical' ||
					findings.some((finding) => finding.severity === 'critical')
					? '❌ **Changes requested** — critical findings block merge.'
					: `❌ **Changes requested** — ${findings.filter((finding) => finding.severity !== 'low').length || result.counts.critical + result.counts.high + result.counts.medium} blocking finding(s). Please address before merge.`
				: describeApprovalDecision(result);
	const footer = footerComment(
		result.model ?? process.env.OPENAI_API_MODEL ?? 'unknown'
	);
	const lines = [
		'# ✨ AI Code Review',
		'',
		formatDecisionBanner(
			result.risk,
			findings,
			result.counts,
			reviewStatus,
			result.approval
		),
		'',
		`**Risk:** ${RISK_LABEL[result.risk]}`,
		`**Duration:** ${formatDuration(result.durationMs)}`,
		truncationNotice,
		filesLine,
		describeReviewExecution({ ...result, reviewStatus }),
		describeApproval(result.approval),
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
		...buildChecksTable(findings, result.counts, result.ruleCoverage),
		'',
		...(result.toolFindings && result.toolFindings.length > 0
			? [
					'<details><summary>Static analyzer findings</summary>',
					'',
					...result.toolFindings.slice(0, 20).map((finding) => {
						const sev = mdSafe(finding.severity);
						const code = mdSafe(finding.code);
						const path = mdSafe(finding.path);
						const line = finding.line;
						const message = mdSafe(finding.message);
						return `- [\`${mdSafe(finding.tool)}/${code}\`] \`${path}:${line}\` (${sev}) ${message}`;
					}),
					result.toolFindings.length > 20
						? `- ... and ${result.toolFindings.length - 20} more`
						: '',
					'</details>',
					'',
				]
			: []),
		...(result.diagnostics &&
		(result.diagnostics.prelintRan?.length ||
			result.diagnostics.prelintSkipped?.length ||
			result.diagnostics.bucketedUnknownCategories ||
			result.diagnostics.crossFindingConflictsResolved ||
			result.diagnostics.trivialPrFastPath !== undefined ||
			result.diagnostics.verifyVerified !== undefined ||
			result.diagnostics.verifyDropped !== undefined ||
			result.diagnostics.verifySkippedReason !== undefined)
			? [
					'<details><summary>Pipeline diagnostics</summary>',
					'',
					...(result.diagnostics.prelintRan?.length
						? [`- **Tools ran:** ${result.diagnostics.prelintRan.join(', ')}`]
						: []),
					...(result.diagnostics.prelintSkipped?.length
						? [
								`- **Tools skipped:** ${result.diagnostics.prelintSkipped.join(', ')}`,
							]
						: []),
					...(result.diagnostics.toolFindingsTotal !== undefined
						? [
								`- **Tool findings total:** ${result.diagnostics.toolFindingsTotal}`,
							]
						: []),
					...(result.diagnostics.bucketedUnknownCategories !== undefined
						? [
								`- **Bucketed (unknown category -> low):** ${result.diagnostics.bucketedUnknownCategories}`,
							]
						: []),
					...(result.diagnostics.crossFindingConflictsResolved !== undefined
						? [
								`- **Cross-finding conflicts resolved:** ${result.diagnostics.crossFindingConflictsResolved}`,
							]
						: []),
					...(result.diagnostics.trivialPrFastPath !== undefined
						? [
								`- **Trivial-PR fast path:** ${result.diagnostics.trivialPrFastPath ? 'yes' : 'no'}`,
							]
						: []),
					...(result.diagnostics.verifyVerified !== undefined ||
					result.diagnostics.verifyDropped !== undefined
						? [
								`- **Verify pass:** kept ${result.diagnostics.verifyVerified ?? 0}, dropped ${result.diagnostics.verifyDropped ?? 0}${result.diagnostics.verifyCostUsd !== undefined ? ` ($${result.diagnostics.verifyCostUsd.toFixed(3)} est.)` : ''}`,
							]
						: []),
					...(result.diagnostics.verifySkippedReason !== undefined
						? [
								`- **Verify pass:** skipped (${result.diagnostics.verifySkippedReason})`,
							]
						: []),
					'</details>',
					'',
				]
			: []),
		footer
	);
	return lines.join('\n');
}

export function stickySummaryMarker(
	owner: string,
	repo: string,
	prNumber: number
): string {
	return `<!-- ai-review-summary:${owner}/${repo}#${prNumber} -->`;
}

function footerComment(model: string): string {
	const repository = process.env.GITHUB_REPOSITORY;
	const runId = process.env.GITHUB_RUN_ID;
	const runUrl =
		repository && runId
			? `https://github.com/${repository}/actions/runs/${runId}`
			: 'n/a';
	const safe = (value: string): string =>
		mdSafe(value)
			.replaceAll('--', '- -')
			.replaceAll(/[\r\n]/g, ' ');
	return `<!-- Auto-generated by AI Code Review (https://github.com/niko0xdev/action-code-review) · model: ${safe(model)} · run: ${safe(runUrl)} -->`;
}
