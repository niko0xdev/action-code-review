import type { OctokitType } from './types';
export declare function areAiCommentsResolved(octokit: OctokitType, owner: string, repo: string, prNumber: number, aiLogin: string): Promise<boolean>;
export declare function approvePullRequest(octokit: OctokitType, owner: string, repo: string, prNumber: number): Promise<void>;
