export declare function createSystemPrompt(customInstructions?: string, templateContent?: string): string;
export declare function buildUserPrompt(currentTitle: string, currentDescription: string, diffs: Array<{
    filename: string;
    status: string;
    patch: string;
}>, includeFileList: boolean): string;
//# sourceMappingURL=pr-content.d.ts.map