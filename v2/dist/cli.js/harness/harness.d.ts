import type { ReviewContext } from '../types/context.js';
import type { Finding, ReviewResult, RiskLevel, ToolFinding } from '../types/finding.js';
export interface ReviewHarness {
    readonly name: string;
    review(context: ReviewContext): Promise<ReviewResult>;
}
export interface HarnessOutput {
    findings: Partial<Finding>[];
    summary: string;
    risk: RiskLevel;
}
export declare function buildReviewPrompt(context: ReviewContext, extraRules?: string, options?: {
    includeFullContent?: boolean;
    maxContextChars?: number;
    toolFindings?: ToolFinding[];
}): string;
export declare function parseHarnessFindings(raw: string): HarnessOutput & {
    findings: Finding[];
};
export declare function toReviewResult(output: HarnessOutput & {
    findings: Finding[];
}, filesReviewed: string[]): ReviewResult;
//# sourceMappingURL=harness.d.ts.map