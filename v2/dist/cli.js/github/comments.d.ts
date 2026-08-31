import type { Finding, RiskLevel } from '../types/finding.js';
export declare function mdSafe(value: string): string;
export declare function severityBadge(finding: Finding): string;
/** Full inline-comment body for a finding, ending with its id marker. */
export declare function buildFindingBody(finding: Finding): string;
type SummaryResult = {
    risk: RiskLevel;
    counts: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
    filesReviewed: string[];
    summary?: string;
    findings?: Finding[];
    model?: string;
    durationMs?: number;
    filesTotal?: number;
    filesExcluded?: number;
};
export declare function formatDecisionBanner(risk: RiskLevel, findings?: Finding[], counts?: SummaryResult['counts']): string;
export declare function buildChecksTable(findings: Finding[], _counts: SummaryResult['counts']): string[];
/** Render rich PR summary while keeping the legacy heading recognizable. */
export declare function buildSummaryBody(result: SummaryResult): string;
export {};
//# sourceMappingURL=comments.d.ts.map