import type { ChangedFile } from '../types/context.js';
import type { Finding } from '../types/finding.js';
/**
 * Finding validation pipeline (spec §18). Nothing reaches GitHub without
 * passing: valid path → changed by PR → confidence floor → not a duplicate.
 */
export interface ValidationOptions {
    /** Confidence floor; spec default 0.80. */
    minConfidence?: number;
}
export declare function validateFinding(finding: Finding, changedFiles: ChangedFile[], minConfidence: number): boolean;
export declare function validateFindings(findings: Finding[], changedFiles: ChangedFile[], minConfidence?: number): Finding[];
//# sourceMappingURL=validator.d.ts.map