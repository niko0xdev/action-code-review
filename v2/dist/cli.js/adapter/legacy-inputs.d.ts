/**
 * Legacy input mapping (docs/v1-interface-contract.md). Every V1 action
 * input maps into engine configuration with identical defaults. Unknown
 * inputs are ignored; missing inputs fall back to the frozen defaults.
 */
export type LegacyAction = 'pr-review' | 'pr-content';
export type LegacyInputs = Record<string, string | undefined>;
export interface PrReviewEngineOptions {
    githubToken: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
    reviewPrompt?: string;
    maxFiles: number;
    excludePatterns: string[];
    includeDirs?: string[];
    autoApproveWhenResolved: boolean;
    minSeverity: string;
    blockOnIssues: boolean;
    includeFullContent: boolean;
    maxContextChars: number;
}
export interface PrContentEngineOptions {
    githubToken: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
    maxTokens: number;
    includeFileList: boolean;
    customInstructions?: string;
    templatePath: string;
}
export declare function mapLegacyInputs(action: LegacyAction, inputs: LegacyInputs): PrReviewEngineOptions | (PrContentEngineOptions & {
    action: 'pr-content';
});
/** Typed wrapper for the pr-review action path. */
export declare function mapPrReviewInputs(inputs: LegacyInputs): PrReviewEngineOptions;
/** Typed wrapper for the pr-content action path. */
export declare function mapPrContentInputs(inputs: LegacyInputs): PrContentEngineOptions & {
    action: 'pr-content';
};
//# sourceMappingURL=legacy-inputs.d.ts.map