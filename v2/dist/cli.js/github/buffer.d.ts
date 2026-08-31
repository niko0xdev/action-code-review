import type { Finding } from '../types/finding.js';
import type { PublisherOctokit } from './review.js';
export declare const BUFFER_PATH: string;
export type BufferedFinding = Finding & {
    ts: string;
    confirmed?: boolean;
};
export declare function appendToBuffer(findings: BufferedFinding[]): void;
export declare function readBuffer(): BufferedFinding[];
export declare function classifyFindings(findings: BufferedFinding[]): {
    real: BufferedFinding[];
    probe: BufferedFinding[];
};
export declare function classifyWithLlm(findings: BufferedFinding[], provider?: {
    complete: (messages: Array<{
        role: string;
        content: string;
    }>, opts: {
        temperature: number;
        maxOutputTokens: number;
    }) => Promise<{
        content: string;
    }>;
}): Promise<boolean[] | null>;
export declare function flushBuffer(octokit: PublisherOctokit, owner: string, repo: string, prNumber: number, headSha: string, provider?: Parameters<typeof classifyWithLlm>[1]): Promise<{
    posted: number;
    filtered: number;
}>;
//# sourceMappingURL=buffer.d.ts.map