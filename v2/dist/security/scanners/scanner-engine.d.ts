import type { ScannerExecution, SecurityContext, SecurityFinding } from '../types.js';
export interface ScanRunResult {
    findings: SecurityFinding[];
    executions: ScannerExecution[];
}
/**
 * Execute all deterministic security scanners for a security run.
 * Spec reference: §5.2, §13.
 */
export declare function runSecurityScanners(context: SecurityContext): Promise<ScanRunResult>;
//# sourceMappingURL=scanner-engine.d.ts.map