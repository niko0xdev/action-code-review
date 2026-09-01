import type { ReviewHarness } from '../harness/harness.js';
import type { ReviewContext } from '../types/context.js';
import { type ReviewResult } from '../types/finding.js';
export interface RunReviewOptions {
    maxFilesPerGroup?: number;
    minConfidence?: number;
    extraRules?: string;
    minSeverity?: string;
}
export declare function runReview(context: ReviewContext, harness: ReviewHarness, options?: RunReviewOptions): Promise<ReviewResult>;
//# sourceMappingURL=reviewer.d.ts.map