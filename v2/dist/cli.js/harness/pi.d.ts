import type { ReviewContext } from '../types/context.js';
import type { ReviewResult, ToolFinding } from '../types/finding.js';
import { type ReviewHarness } from './harness.js';
export declare const PI_READONLY_TOOLS: readonly ["read", "grep", "find", "ls"];
export interface PiHarnessOptions {
    binaryPath?: string;
    timeoutMs?: number;
    provider?: string;
    model?: string;
    apiKey?: string;
    extraRules?: string;
    includeFullContent?: boolean;
    maxContextChars?: number;
    /**
     * Static-analyzer findings to inject as evidence in the LLM prompt.
     * Sourced from `context/prelint.ts`. Optional - when omitted, the
     * prompt is rendered without a tool-findings section (backward
     * compatible with V2 callers that don't run prelint).
     */
    toolFindings?: ToolFinding[];
}
export declare function buildPiArgs(repositoryPath: string, model?: string, provider?: string): string[];
export declare function buildPiEnv(configDir: string, apiKey?: string): NodeJS.ProcessEnv;
export declare function extractAssistantText(stdout: string): string;
export declare class PiHarness implements ReviewHarness {
    private readonly options;
    readonly name = "pi";
    constructor(options?: PiHarnessOptions);
    review(context: ReviewContext): Promise<ReviewResult>;
}
//# sourceMappingURL=pi.d.ts.map