import type { OctokitType } from './types';
/**
 * Update AI review comments based on PR changes
 */
export declare function updateCommentsOnPrChange(octokit: OctokitType, owner: string, repo: string, prNumber: number, headSha: string): Promise<void>;
