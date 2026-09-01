import type { Finding } from '../types/finding.js';
export declare function normalizeTitle(title: string): string;
export declare function dedupeFindings(findings: Finding[]): Finding[];
export declare function legacySeverity(severity: Finding['severity']): string;
export declare function commentIdentityBody(finding: Finding): string;
export declare function normalizeCommentId(finding: Finding): string;
//# sourceMappingURL=dedupe.d.ts.map