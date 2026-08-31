export type ProgressPhase = 'fetch' | 'filter' | 'profiles' | 'harness' | 'publish';
export declare function trackPhase(phase: ProgressPhase, detail: string, options: {
    enabled: boolean;
}): void;
export declare function writeSummaryBlock(title: string, lines: string[], options: {
    enabled: boolean;
}): void;
//# sourceMappingURL=progress.d.ts.map