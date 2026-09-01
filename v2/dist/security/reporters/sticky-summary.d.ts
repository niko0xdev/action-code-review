import type { ScannerExecution, SecurityFinding } from '../types.js';
export interface StickySummaryOptions {
    risk: string;
    validatedCount: number;
    rejectedCount: number;
    findings: SecurityFinding[];
    scanners: ScannerExecution[];
    domains: string[];
    model?: string;
    durationMs?: number;
}
/**
 * Render sticky security summary comment for GitHub PR.
 * Spec reference: §16.
 */
export declare function buildStickySecuritySummary(options: StickySummaryOptions): string;
//# sourceMappingURL=sticky-summary.d.ts.map