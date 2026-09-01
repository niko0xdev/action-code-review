import type { ScannerExecution, SecurityFinding } from '../types.js';
/**
 * Execute Semgrep CLI if installed and parse JSON output.
 * Spec reference: §13.
 */
export declare function runSemgrepScanner(repositoryPath: string, targetFiles: string[]): Promise<{
    execution: ScannerExecution;
    findings: SecurityFinding[];
}>;
//# sourceMappingURL=semgrep.d.ts.map