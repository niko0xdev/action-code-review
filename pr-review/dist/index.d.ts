import * as github from '@actions/github';
import type { ReviewComment } from './reviewParser';
type OctokitType = ReturnType<typeof github.getOctokit>;
declare function postCommentsToPR(octokit: OctokitType, owner: string, repo: string, prNumber: number, comments: ReviewComment[], commitId: string): Promise<void>;
export { parseReviewForComments, parseReviewResponse } from './reviewParser';
export { postCommentsToPR };
