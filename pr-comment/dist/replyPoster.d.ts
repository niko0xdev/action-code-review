import type { OctokitType } from './types';
import type { ReplyOptions } from './types';
/**
 * Post a reply to a comment on a PR
 */
export declare function postReplyToComment(octokit: OctokitType, options: ReplyOptions, replyBody: string): Promise<void>;
/**
 * Post a reply with fallback to issue comment if thread reply fails
 */
export declare function postReplyWithFallback(octokit: OctokitType, options: ReplyOptions, replyBody: string): Promise<void>;
