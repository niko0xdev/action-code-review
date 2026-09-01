import type { SecurityFinding } from '../types.js';
/**
 * Generate valid SARIF v2.1.0 JSON representation from normalized security findings.
 * Spec reference: §18.
 */
export declare function generateSarif(findings: SecurityFinding[], toolName?: string, toolVersion?: string): string;
//# sourceMappingURL=sarif-generator.d.ts.map