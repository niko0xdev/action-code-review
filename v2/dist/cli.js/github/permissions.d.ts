import type { PublisherOctokit } from './review.js';
export declare function isBotActor(actor: string): boolean;
export declare function hasWritePermission(octokit: PublisherOctokit, owner: string, repo: string, actor: string): Promise<boolean>;
//# sourceMappingURL=permissions.d.ts.map