import { CONFIDENCE_RANKS, SEVERITY_RANKS } from '../types.js';
/**
 * Deduplicate security findings using fingerprints and semantic merging.
 * Spec reference: §11, §12.
 */
export function deduplicateFindings(findings) {
    const map = new Map();
    for (const finding of findings) {
        const existing = map.get(finding.fingerprint);
        if (!existing) {
            map.set(finding.fingerprint, { ...finding });
            continue;
        }
        // Merge: preserve highest severity and highest confidence
        const existingSevRank = SEVERITY_RANKS[existing.severity] ?? 0;
        const newSevRank = SEVERITY_RANKS[finding.severity] ?? 0;
        if (newSevRank > existingSevRank) {
            existing.severity = finding.severity;
        }
        const existingConfRank = CONFIDENCE_RANKS[existing.confidence] ?? 0;
        const newConfRank = CONFIDENCE_RANKS[finding.confidence] ?? 0;
        if (newConfRank > existingConfRank) {
            existing.confidence = finding.confidence;
        }
        if (finding.status === 'validated' && existing.status !== 'validated') {
            existing.status = 'validated';
        }
        // Merge scanner sources
        const scannerSources = new Set([
            ...(existing.scannerSources || []),
            ...(finding.scannerSources || []),
        ]);
        if (scannerSources.size > 0) {
            existing.scannerSources = Array.from(scannerSources);
        }
        // Merge evidence
        for (const ev of finding.evidence) {
            const isDuplicate = existing.evidence.some((e) => e.description === ev.description && e.type === ev.type);
            if (!isDuplicate) {
                existing.evidence.push(ev);
            }
        }
        // Preserve remediation if missing
        if (!existing.remediation && finding.remediation) {
            existing.remediation = finding.remediation;
        }
    }
    return Array.from(map.values());
}
//# sourceMappingURL=dedupe.js.map