export interface PrContentOctokit {
    rest: {
        pulls: {
            get(args: unknown): Promise<{
                data: {
                    title: string;
                    body?: string | null;
                };
            }>;
            listFiles(args: Record<string, unknown>): Promise<{
                data: unknown[];
            }>;
            update(args: Record<string, unknown>): Promise<{
                data: unknown;
            }>;
        };
    };
}
export interface PrContentUpdateOptions {
    octokit: PrContentOctokit;
    owner: string;
    repo: string;
    prNumber: number;
    response: string;
    templateContent?: string;
}
export declare function updatePrContent(octokit: PrContentOctokit, owner: string, repo: string, prNumber: number, options: Pick<PrContentUpdateOptions, 'response' | 'templateContent'>): Promise<void>;
export declare function parsePrContentResponse(response: string): {
    title: string;
    description: string;
};
//# sourceMappingURL=pr-content.d.ts.map