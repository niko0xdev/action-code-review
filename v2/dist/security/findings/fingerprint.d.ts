import type { SecurityFinding } from '../types.js';
/**
 * Generate a stable fingerprint for a security finding.
 * Spec reference: §12.
 * Combination of normalized file path, category/CWE, and normalized sink/title.
 * Does NOT depend solely on line numbers because lines shift across commits.
 */
export declare function computeFindingFingerprint(finding: Partial<SecurityFinding> & {
    title: string;
}, repo?: string): string;
//# sourceMappingURL=fingerprint.d.ts.map