import type { ReviewComment } from './types';
export type { ReviewComment } from './types';
export interface ParsedReviewData {
    summary: string;
    comments: ReviewComment[];
}
export declare function filterCommentsBySeverity(comments: ReviewComment[], minSeverity: string): ReviewComment[];
export declare function parseReviewForComments(reviewText: string, filename: string): ReviewComment[];
export declare function parseReviewResponse(reviewText: string, filename: string): ParsedReviewData;
