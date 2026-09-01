import type { FileChangeStatus, RepositoryInfo, ReviewContext } from '../types/context.js';
/**
 * PR context assembly: repository + pull request + diff straight from the
 * GitHub API. Kept transport-agnostic via a minimal structural type so
 * tests can pass plain fakes.
 */
export interface OctokitLike {
    rest: {
        pulls: {
            get(args: unknown): Promise<{
                data: PullRequestWire;
            }>;
            listFiles(args: Record<string, unknown>): Promise<{
                data: FileWire[];
            }>;
        };
        users?: {
            getAuthenticated: () => Promise<{
                data: {
                    login: string;
                };
            }>;
        };
    };
}
interface PullRequestWire {
    number: number;
    title: string;
    body?: string | null;
    draft?: boolean;
    head: {
        ref: string;
        sha: string;
    };
    base: {
        ref: string;
        sha: string;
    };
    user?: {
        login?: string;
    } | null;
}
interface FileWire {
    filename: string;
    status: FileChangeStatus;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
    previous_filename?: string;
}
export interface FetchPrOptions {
    pageSize?: number;
    maxPages?: number;
}
export declare function fetchPrContext(octokit: OctokitLike, repository: RepositoryInfo, prNumber: number, options?: FetchPrOptions): Promise<ReviewContext>;
export {};
//# sourceMappingURL=pr.d.ts.map