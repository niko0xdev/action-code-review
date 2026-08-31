import type { SecurityFinding } from '../types.js';
/**
 * Deduplicate security findings using fingerprints and semantic merging.
 * Spec reference: §11, §12.
 */
export declare function deduplicateFindings(findings: SecurityFinding[]): SecurityFinding[];
//# sourceMappingURL=dedupe.d.ts.map