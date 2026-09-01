import { commentIdentityBody, normalizeCommentId } from '../review/dedupe.js';
export function mdSafe(value) {
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
const SEVERITY_ICON = {
    critical: '🚨',
    high: '🔥',
    medium: '⚠️',
    low: '✅',
};
const CATEGORY_LABEL = {
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
export function severityBadge(finding) {
    const icon = SEVERITY_ICON[finding.severity] ?? '•';
    const label = finding.severity.toUpperCase();
    const category = CATEGORY_LABEL[finding.category] ?? finding.category;
    return `${icon} ${label} · ${category}`;
}
/** Full inline-comment body for a finding, ending with its id marker. */
export function buildFindingBody(finding) {
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
const RISK_LABEL = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    none: 'None',
};
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const CATEGORIES = Object.keys(CATEGORY_LABEL);
function hasBlockingFindings(findings, counts) {
    return findings.length > 0
        ? findings.some((finding) => finding.severity !== 'low')
        : counts.critical + counts.high + counts.medium > 0;
}
export function formatDecisionBanner(risk, findings = [], counts = { critical: 0, high: 0, medium: 0, low: 0 }) {
    if (risk === 'critical' ||
        findings.some((finding) => finding.severity === 'critical'))
        return '> 🚨 **CRITICAL — merge blocked**';
    return hasBlockingFindings(findings, counts)
        ? '> ⚠️ **CHANGES REQUESTED**'
        : '> ✨ **APPROVED**';
}
export function buildChecksTable(findings, _counts, ruleCoverage) {
    const categoryCounts = new Map();
    for (const finding of findings)
        categoryCounts.set(finding.category, (categoryCounts.get(finding.category) ?? 0) + 1);
    const rulesCell = ruleCoverage
        ? `${ruleCoverage.passed}/${ruleCoverage.total} passed`
        : 'N/A';
    const failedCell = ruleCoverage && ruleCoverage.failedRules.length > 0
        ? ruleCoverage.failedRules
            .map((rule) => `- ${mdSafe(rule)
            .replaceAll('|', '\\|')
            .replaceAll(/[\r\n]/g, ' ')}`)
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
function formatDuration(durationMs) {
    if (durationMs === undefined)
        return 'n/a';
    const seconds = durationMs / 1000;
    return `${Number(seconds.toFixed(1))}s`;
}
function findingLines(findings = []) {
    if (!findings.length)
        return ['## Top findings', '', 'No findings.'];
    const sorted = [...findings]
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        b.confidence - a.confidence)
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
export function buildSummaryBody(result) {
    const findings = result.findings ?? [];
    const blocking = hasBlockingFindings(findings, result.counts);
    const reviewed = result.filesReviewed.length;
    const excluded = result.filesExcluded ??
        Math.max((result.filesTotal ?? reviewed) - reviewed, 0);
    const total = result.filesTotal ?? reviewed + excluded;
    const filesLine = result.filesTotal !== undefined || result.filesExcluded !== undefined
        ? `**Files reviewed:** ${reviewed} of ${total} (${excluded} excluded by filter)`
        : `**Files reviewed:** ${reviewed}`;
    const decision = blocking
        ? result.risk === 'critical' ||
            findings.some((finding) => finding.severity === 'critical')
            ? '❌ **Changes requested** — critical findings block merge.'
            : `❌ **Changes requested** — ${findings.filter((finding) => finding.severity !== 'low').length || result.counts.critical + result.counts.high + result.counts.medium} blocking finding(s). Please address before merge.`
        : '✅ **All clear** — no blocking findings. Approving.';
    const footer = footerComment(result.model ?? process.env.OPENAI_API_MODEL ?? 'unknown');
    const lines = [
        '# ✨ AI Code Review',
        '',
        formatDecisionBanner(result.risk, findings, result.counts),
        '',
        `**Risk:** ${RISK_LABEL[result.risk]}`,
        `**Duration:** ${formatDuration(result.durationMs)}`,
        filesLine,
        `**Reviewed files:** ${reviewed}`,
        `**Severity counts:** Critical: ${result.counts.critical} · High: ${result.counts.high} · Medium: ${result.counts.medium} · Low: ${result.counts.low}`,
    ];
    if (result.summary)
        lines.push('', result.summary);
    lines.push('', '## Findings', '', '| Severity | Count | Status |', '|----------|------:|:------:|', `| 🚨 Critical | ${result.counts.critical} | ${result.counts.critical ? '❌' : '✅'} |`, `| 🔥 High | ${result.counts.high} | ${result.counts.high ? '❌' : '✅'} |`, `| ⚠️ Medium | ${result.counts.medium} | ${result.counts.medium ? '❌' : '✅'} |`, `| ✅ Low | ${result.counts.low} | ${result.counts.low ? '❌' : '✅'} |`, '', '## Decision', '', decision, '', ...findingLines(findings), '', ...buildChecksTable(findings, result.counts, result.ruleCoverage), '', ...(result.toolFindings && result.toolFindings.length > 0
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
        : []), ...(result.diagnostics &&
        (result.diagnostics.prelintRan?.length ||
            result.diagnostics.prelintSkipped?.length ||
            result.diagnostics.bucketedUnknownCategories ||
            result.diagnostics.crossFindingConflictsResolved ||
            result.diagnostics.trivialPrFastPath)
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
            '</details>',
            '',
        ]
        : []), footer);
    return lines.join('\n');
}
export function stickySummaryMarker(owner, repo, prNumber) {
    return `<!-- ai-review-summary:${owner}/${repo}#${prNumber} -->`;
}
function footerComment(model) {
    const repository = process.env.GITHUB_REPOSITORY;
    const runId = process.env.GITHUB_RUN_ID;
    const runUrl = repository && runId
        ? `https://github.com/${repository}/actions/runs/${runId}`
        : 'n/a';
    const safe = (value) => mdSafe(value)
        .replaceAll('--', '- -')
        .replaceAll(/[\r\n]/g, ' ');
    return `<!-- Auto-generated by AI Code Review (https://github.com/niko0xdev/action-code-review) · model: ${safe(model)} · run: ${safe(runUrl)} -->`;
}
//# sourceMappingURL=comments.js.map