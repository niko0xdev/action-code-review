export declare function createSystemPrompt(customInstructions: string): string;
export declare function buildUserPrompt(currentTitle: string, currentDescription: string, diffs: Array<{
    filename: string;
    status: string;
    patch: string;
}>, includeFileList: boolean): string;
//# sourceMappingURL=prompts.d.ts.map