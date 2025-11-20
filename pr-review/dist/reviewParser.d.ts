export interface ReviewComment {
    path: string;
    line: number;
    body: string;
    id: string;
}
export interface ParsedReviewData {
    summary: string;
    comments: ReviewComment[];
}
export declare function parseReviewForComments(reviewText: string, filename: string): ReviewComment[];
export declare function parseReviewResponse(reviewText: string, filename: string): ParsedReviewData;
