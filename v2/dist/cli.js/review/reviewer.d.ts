import type { ReviewHarness } from '../harness/harness.js';
import type { ReviewContext } from '../types/context.js';
import { type ReviewResult } from '../types/finding.js';
export interface RunReviewOptions {
    maxFilesPerGroup?: number;
    minConfidence?: number;
    extraRules?: string;
    minSeverity?: string;
    /**
     * Phase 5: two-pass verify. When set, runVerifyPass() is invoked
     * after the main pass with this callback. Env-controlled via
     * AI_REVIEW_VERIFY_PASS=true + cost ceiling (default 0.50 USD).
     */
    verify?: (prompt: string) => Promise<string>;
    /** Approximate token count of the verify prompt input. */
    inputTokenEstimate?: number;
    /** Token budget for verify output (typically 1024). */
    outputTokenBudget?: number;
    /** Cost ceiling in USD (default 0.50). */
    verifyBudgetUsd?: number;
}
export declare function runReview(context: ReviewContext, harness: ReviewHarness, options?: RunReviewOptions): Promise<ReviewResult>;
//# sourceMappingURL=reviewer.d.ts.map