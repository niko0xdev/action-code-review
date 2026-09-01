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
    piArgs?: string;
    /**
     * Static-analyzer findings to inject as evidence in the LLM prompt.
     * Sourced from `context/prelint.ts`. Optional - when omitted, the
     * prompt is rendered without a tool-findings section (backward
     * compatible with V2 callers that don't run prelint).
     */
    toolFindings?: ToolFinding[];
}
export declare function parsePiArgs(raw: string): string[];
export declare function buildPiArgs(repositoryPath: string, model?: string, provider?: string, extraArgs?: string[]): string[];
export declare function buildPiEnv(configDir: string, apiKey?: string): NodeJS.ProcessEnv;
export declare function extractAssistantText(stdout: string): string;
export interface PiRunLog {
    stdout: string;
    stderr: string;
}
export declare const AGENT_DEBUG_MAX_CHARS: number;
export declare function buildAgentDebugSection(runs: readonly PiRunLog[]): string | null;
export declare class PiHarness implements ReviewHarness {
    private readonly options;
    readonly name = "pi";
    private _runs;
    constructor(options?: PiHarnessOptions);
    get runs(): readonly PiRunLog[];
    get lastRun(): PiRunLog | null;
    review(context: ReviewContext): Promise<ReviewResult>;
}
//# sourceMappingURL=pi.d.ts.map