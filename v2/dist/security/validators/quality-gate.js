import { deduplicateFindings } from '../findings/dedupe.js';
import { CONFIDENCE_RANKS, SEVERITY_RANKS } from '../types.js';
/**
 * Quality gate pipeline:
 * 1. Confidence threshold check
 * 2. File and line boundary check against PR scope
 * 3. Evidence threshold check
 * 4. Severity threshold filtering
 * 5. Deduplication
 * 6. Max findings capping
 *
 * Spec reference: §11, §29.
 */
export function applyQualityGate(candidates, context, minSeverity = 'medium', minConfidence = 'medium', maxFindings = 20) {
    const validated = [];
    const rejected = [];
    const allowedFiles = new Set(context.changedFiles.map((f) => f.filename));
    const minSevRank = SEVERITY_RANKS[minSeverity] ?? 2;
    const minConfRank = CONFIDENCE_RANKS[minConfidence] ?? 1;
    // Deduplicate before gating
    const deduped = deduplicateFindings(candidates);
    for (const finding of deduped) {
        // 1. File existence / PR boundary check (if file is provided)
        if (finding.file &&
            allowedFiles.size > 0 &&
            !allowedFiles.has(finding.file)) {
            finding.status = 'rejected';
            rejected.push(finding);
            continue;
        }
        // 2. Confidence threshold
        const confRank = CONFIDENCE_RANKS[finding.confidence] ?? 0;
        if (confRank < minConfRank) {
            finding.status = 'rejected';
            rejected.push(finding);
            continue;
        }
        // 3. Evidence threshold: must have at least one piece of evidence or clear reasoning
        if (!finding.evidence || finding.evidence.length === 0) {
            finding.status = 'rejected';
            rejected.push(finding);
            continue;
        }
        // 4. Severity threshold
        const sevRank = SEVERITY_RANKS[finding.severity] ?? 0;
        if (sevRank < minSevRank) {
            // Below publish threshold
            finding.status = 'rejected';
            rejected.push(finding);
            continue;
        }
        // Passed quality gate
        finding.status = 'validated';
        validated.push(finding);
    }
    // Sort validated findings by severity desc, then confidence desc
    validated.sort((a, b) => {
        const sevDiff = (SEVERITY_RANKS[b.severity] ?? 0) - (SEVERITY_RANKS[a.severity] ?? 0);
        if (sevDiff !== 0)
            return sevDiff;
        return ((CONFIDENCE_RANKS[b.confidence] ?? 0) -
            (CONFIDENCE_RANKS[a.confidence] ?? 0));
    });
    // Apply maxFindings cap
    let cappedValidated = validated;
    if (validated.length > maxFindings) {
        const excess = validated.slice(maxFindings);
        for (const f of excess) {
            f.status = 'rejected';
            rejected.push(f);
        }
        cappedValidated = validated.slice(0, maxFindings);
    }
    return {
        validated: cappedValidated,
        rejected,
    };
}
//# sourceMappingURL=quality-gate.js.map