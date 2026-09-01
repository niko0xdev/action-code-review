/**
 * Two-pass verify (V3 Phase 5, decision Q4).
 *
 * After the main review pass, optionally runs a second short LLM call
 * that asks the model to challenge its own high/critical findings.
 * The verify pass is bounded by:
 * - Opt-in via `AI_REVIEW_VERIFY_PASS=true` env var (default false).
 * - Cost ceiling of `AI_REVIEW_VERIFY_BUDGET_USD` (default 0.50 USD).
 * - Skipped when zero high/critical findings (nothing worth verifying).
 *
 * Output: a verified copy of the input findings where each surviving
 * finding has a `verified: true` marker set on its body. Dropped
 * findings are silently removed. Cost is tracked via token estimate
 * (input + output) using a per-1K-token rate.
 */
import type { Finding, ToolFinding } from '../types/finding.js';
export interface VerifyPassOptions {
    /** Findings from the main pass (post-validation). */
    findings: Finding[];
    /** Original tool findings context for the verify prompt. */
    toolFindings: ToolFinding[];
    /** Original repo + PR context (for the verify prompt). */
    context: {
        title: string;
        body: string;
        filenames: string[];
    };
    /** Function that runs the verify LLM call. */
    verify: (prompt: string) => Promise<string>;
    /** Estimated input tokens for the verify prompt. */
    inputTokenEstimate: number;
    /** Estimated output tokens (capped by the model). */
    outputTokenBudget: number;
    /** Cost ceiling in USD. Default 0.50. */
    budgetUsd?: number;
    /** Per-1K-token USD rate (input + output averaged). Default 0.001 (Haiku-class). */
    ratePer1K?: number;
}
export interface VerifyPassResult {
    findings: Finding[];
    verifiedCount: number;
    droppedCount: number;
    skipped: boolean;
    skipReason?: string;
    estimatedCostUsd: number;
}
/**
 * Build the verify prompt. The model is asked to challenge each
 * high/critical finding with three yes/no questions. The model must
 * return JSON in the same shape, but each finding either survives
 * (verified) or is dropped.
 */
export declare function buildVerifyPrompt(highCritical: Finding[], toolFindings: ToolFinding[], context: {
    title: string;
    body: string;
    filenames: string[];
}): string;
/**
 * Estimate the cost of running the verify pass. Conservative estimate
 * uses input tokens + output budget.
 */
export declare function estimateCostUsd(inputTokens: number, outputTokens: number, ratePer1K: number): number;
/**
 * Run the verify pass. Always resolves (never throws). When skipped,
 * returns the input findings unchanged with a skip reason.
 */
export declare function runVerifyPass(options: VerifyPassOptions): Promise<VerifyPassResult>;
//# sourceMappingURL=verify.d.ts.map