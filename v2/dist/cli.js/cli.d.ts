export declare function parseArgs(args: string[]): {
    action: string;
};
export declare function main(argv: string[]): Promise<void>;
export declare function applyLegacyFilters(filenames: string[], options: {
    excludePatterns: string[];
    includeDirs?: string[];
}): string[];
