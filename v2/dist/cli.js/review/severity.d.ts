import { type Finding, type FindingCounts, type RiskLevel } from '../types/finding.js';
/**
 * Severity handling (spec §19): per-severity caps plus an overall cap.
 * Overflow is resolved by severity rank first, confidence second.
 */
export declare function computeCounts(findings: Finding[]): FindingCounts;
export declare function capFindings(findings: Finding[]): Finding[];
/** Overall risk from the surviving findings (spec §20/§21). */
export declare function riskFromFindings(findings: Finding[]): RiskLevel;
//# sourceMappingURL=severity.d.ts.map