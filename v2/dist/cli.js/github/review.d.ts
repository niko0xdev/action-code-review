import type { OctokitLike } from '../context/pr.js';
import type { Finding, ReviewResult } from '../types/finding.js';
import type { ReplyParams, ReplyResult, ReviewReply } from '../types/reply.js';
export { buildFindingBody, buildSummaryBody } from './comments.js';
interface ReviewRecord {
    id: number;
    user?: {
        login?: string;
    } | null;
}
interface ReviewCommentRecord {
    body?: string | null;
    pull_request_url?: string | null;
    user?: {
        login?: string;
    } | null;
}
export interface PublisherOctokit extends OctokitLike {
    rest: OctokitLike['rest'] & {
        pulls: OctokitLike['rest']['pulls'] & {
            update(args: Record<string, unknown>): Promise<{
                data: unknown;
            }>;
            createReview(args: Record<string, unknown>): Promise<{
                data: unknown;
            }>;
            createReviewComment(args: Record<string, unknown>): Promise<{
                data: unknown;
            }>;
            createReplyForReviewComment(args: {
                owner: string;
                repo: string;
                pull_number: number;
                comment_id: number;
                body: string;
            }): Promise<{
                data: {
                    id: number;
                    html_url: string;
                };
            }>;
            getReviewComment(args: Record<string, unknown>): Promise<{
                data: ReviewCommentRecord;
            }>;
            listReviews?: (args: Record<string, unknown>) => Promise<{
                data: ReviewRecord[];
            }>;
            listCommentsForReview?: (args: Record<string, unknown>) => Promise<{
                data: ReviewCommentRecord[];
            }>;
        };
        issues: {
            createComment(args: Record<string, unknown>): Promise<{
                data: unknown;
            }>;
        };
    };
    users?: {
        getAuthenticated: () => Promise<{
            data: {
                login: string;
            };
        }>;
    };
}
export interface ReviewCommentWire {
    path: string;
    line: number;
    side: 'RIGHT';
    body: string;
}
export interface ReviewPayload {
    commit_id: string;
    event: 'REQUEST_CHANGES' | 'COMMENT' | 'APPROVE';
    comments: ReviewCommentWire[];
    body?: string;
}
export interface PublishParams {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
    result: ReviewResult;
    blockOnIssues?: boolean;
    minSeverity?: string;
    model?: string;
    durationMs?: number;
    filesTotal?: number;
    filesExcluded?: number;
}
export declare function buildReviewPayload(findings: Finding[], headSha: string, options?: {
    blockOnIssues?: boolean;
}): ReviewPayload;
export declare function publishReview(octokit: PublisherOctokit, params: PublishParams): Promise<void>;
export declare function buildReplyBody(body: string, finding?: Finding): string;
export declare function replyToReviewComment(octokit: PublisherOctokit, params: ReplyParams): Promise<ReplyResult>;
export declare function postReviewReply(octokit: PublisherOctokit, reply: ReviewReply, target: {
    owner: string;
    repo: string;
    prNumber: number;
}): Promise<ReplyResult>;
export declare function buildJobSummary(input: {
    model?: string;
    durationMs?: number;
    filesReviewed: string[];
    result: Pick<ReviewResult, 'counts' | 'risk'> & {
        findings: unknown[];
    };
}): string;
//# sourceMappingURL=review.d.ts.map