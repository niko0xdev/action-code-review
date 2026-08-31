import type { RiskClassification, ScannerExecution, SecurityFinding } from '../types.js';
export interface AuditReportOptions {
    owner: string;
    repo: string;
    profile: string;
    riskClassification: RiskClassification;
    findings: SecurityFinding[];
    scanners: ScannerExecution[];
    durationMs?: number;
}
/**
 * Generate full markdown audit report for repository security audits.
 * Spec reference: §19.
 */
export declare function buildFullAuditReport(options: AuditReportOptions): string;
//# sourceMappingURL=audit-reporter.d.ts.map