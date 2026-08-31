import type { ReviewContext } from '../types/context.js';
/**
 * Review planning (spec §31): small PRs go through in one pass; large PRs
 * are partitioned into logical areas and reviewed sequentially.
 */
export interface ReviewGroup {
    area: string;
    files: string[];
}
export declare function planReviewGroups(context: ReviewContext, maxFilesPerGroup?: number): ReviewGroup[];
//# sourceMappingURL=planner.d.ts.map