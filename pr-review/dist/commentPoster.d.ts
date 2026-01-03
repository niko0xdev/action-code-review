import type { ReviewComment } from './reviewParser';
import type { ReviewOptions } from './types';
import type { OctokitType } from './types';
export declare function getAuthenticatedLogin(octokit: OctokitType): Promise<string | null>;
export declare function filterDuplicateComments(comments: ReviewComment[], existingIds: Set<string>): {
    newComments: ReviewComment[];
    duplicateCount: number;
};
export declare function appendCommentId(comment: ReviewComment): string;
export declare function groupCommentsByFile(comments: ReviewComment[]): Record<string, ReviewComment[]>;
export declare function postCommentsToPR(octokit: OctokitType, comments: ReviewComment[], commitId: string, options: ReviewOptions): Promise<void>;
