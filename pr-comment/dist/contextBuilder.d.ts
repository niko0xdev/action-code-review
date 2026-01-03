import type { OctokitType } from './types';
import type { CommentContext, ContextOptions } from './types';
/**
 * Build context for generating a reply
 */
export declare function buildContextForReply(octokit: OctokitType, commentId: number, prNumber: number, owner: string, repo: string, headSha: string, prTitle: string, commentBody: string, commentUser: string, commentCreatedAt: string, options: ContextOptions): Promise<CommentContext | null>;
/**
 * Create default context options
 */
export declare function createDefaultContextOptions(includeFullContent?: boolean, maxContextChars?: number): ContextOptions;
