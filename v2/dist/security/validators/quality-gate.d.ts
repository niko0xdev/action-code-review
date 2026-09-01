import type { SecurityConfidence, SecurityContext, SecurityFinding, SecuritySeverity } from '../types.js';
export interface QualityGateResult {
    validated: SecurityFinding[];
    rejected: SecurityFinding[];
}
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
export declare function applyQualityGate(candidates: SecurityFinding[], context: SecurityContext, minSeverity?: SecuritySeverity, minConfidence?: SecurityConfidence, maxFindings?: number): QualityGateResult;
//# sourceMappingURL=quality-gate.d.ts.map