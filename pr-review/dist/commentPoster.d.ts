import type { ReviewComment } from './reviewParser';
import type { ReviewOptions } from './types';
import type { OctokitType } from './types';
interface ExistingReviewComment {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    githubCommentId: number;
    body: string;
}
/**
 * Check if two line ranges overlap
 * Example: [15, 20] overlaps with [14, 21] because max(15, 14) = 15 <= min(20, 21) = 20
 */
export declare function checkLineOverlap(startLine1: number, endLine1: number, startLine2: number, endLine2: number): boolean;
/**
 * Find an existing comment that matches the new comment
 * Matches by ID first, then by overlapping line ranges
 */
export declare function findMatchingComment(newComment: ReviewComment, existingComments: ExistingReviewComment[]): ExistingReviewComment | null;
export declare function getAuthenticatedLogin(octokit: OctokitType): Promise<string | null>;
export declare function appendCommentId(comment: ReviewComment): string;
export declare function groupCommentsByFile(comments: ReviewComment[]): Record<string, ReviewComment[]>;
export declare function postCommentsToPR(octokit: OctokitType, comments: ReviewComment[], commitId: string, options: ReviewOptions): Promise<void>;
export {};
