import type { PublisherOctokit } from '../../github/review.js';
import type { SecurityResult } from '../types.js';
export interface SecurityPublishParams {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
    result: SecurityResult;
    inlineComments?: boolean;
    stickyComment?: boolean;
}
/**
 * Publish security findings (inline review comments and sticky summary) to GitHub PR.
 * Spec reference: §16, §17.
 */
export declare function publishSecurityReview(octokit: PublisherOctokit, params: SecurityPublishParams): Promise<void>;
//# sourceMappingURL=security-publisher.d.ts.map