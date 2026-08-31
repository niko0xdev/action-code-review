import type { OctokitType } from './types';
/**
 * Post an inline reply beneath an existing review comment thread.
 *
 * Activated only through environment variables (INPUT_REPLY_TO_COMMENT_ID
 * + INPUT_REPLY_BODY) so the public action inputs stay untouched. The
 * comment id is GitHub's numeric review comment id — not the
 * ai-review-id marker embedded in bodies.
 */
export interface ReplyOutcome {
    posted: boolean;
    id?: number;
    html_url?: string;
    reason?: string;
}
export declare function readReplyRequest(getEnv?: (name: string) => string | undefined): {
    commentId: number;
    body: string;
} | null;
export declare function replyToReviewComment(octokit: OctokitType, owner: string, repo: string, prNumber: number, commentId: number, body: string): Promise<ReplyOutcome>;
/** Read env-driven reply request and post it if present. Fire-and-forget safe. */
export declare function maybePostConfiguredReply(octokit: OctokitType, owner: string, repo: string, prNumber: number): Promise<ReplyOutcome>;
