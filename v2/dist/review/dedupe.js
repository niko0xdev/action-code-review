import { createHash } from 'node:crypto';
export function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function dedupeKey(finding) {
    return [
        finding.path,
        finding.line,
        finding.category,
        finding.ruleId?.trim() ||
            normalizeTitle(finding.title).split(' ').slice(0, 4).join(' '),
    ].join('|');
}
export function dedupeFindings(findings) {
    const best = new Map();
    for (const finding of findings) {
        const key = dedupeKey(finding);
        const existing = best.get(key);
        if (!existing || finding.confidence > existing.confidence) {
            best.set(key, finding);
        }
    }
    return [...best.values()];
}
export function legacySeverity(severity) {
    return severity === 'medium' ? 'low' : severity;
}
export function commentIdentityBody(finding) {
    const icons = {
        critical: '🚨',
        high: '🔥',
        medium: '⚠️',
        low: '✅',
    };
    const categories = {
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
    if (finding.replacement &&
        finding.confidence >= 0.85 &&
        finding.replacement.split('\n').length <= 10 &&
        finding.replacement.length <= 400) {
        parts.push(['```suggestion', finding.replacement, '```'].join('\n'));
    }
    return parts.filter(Boolean).join('\n\n').trim();
}
export function normalizeCommentId(finding) {
    return createHash('sha256')
        .update([
        finding.path,
        finding.line.toString(),
        commentIdentityBody(finding),
        finding.ruleId?.trim() ?? '',
    ].join('|'))
        .digest('hex')
        .slice(0, 12);
}
//# sourceMappingURL=dedupe.js.map