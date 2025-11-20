import type { ReviewComment } from './reviewParser';
interface OctokitType {
    rest: {
        pulls: {
            list: (params: any) => Promise<any>;
            listFiles: (params: any) => Promise<any>;
            createReview: (params: any) => Promise<any>;
            createReviewComment: (params: any) => Promise<any>;
        };
        issues: {
            createComment: (params: any) => Promise<any>;
        };
    };
}
declare function postCommentsToPR(octokit: OctokitType, owner: string, repo: string, prNumber: number, comments: ReviewComment[], commitId: string): Promise<void>;
export { parseReviewForComments, parseReviewResponse } from './reviewParser';
export { postCommentsToPR };
