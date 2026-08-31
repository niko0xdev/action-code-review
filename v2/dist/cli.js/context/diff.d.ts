/**
 * Unified-diff helpers. Findings must anchor to new-side line numbers so
 * GitHub can place inline comments; these utilities do that mapping.
 */
export interface HunkHeader {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
}
export type PatchLineType = 'context' | 'addition' | 'deletion';
export interface PatchLine {
    type: PatchLineType;
    /** 1-based line in the post-change file; undefined for deletions. */
    newLine?: number;
    content?: string;
}
export declare function parseUnifiedHunkHeader(line: string): HunkHeader | null;
/** Map every patch line to its new-side position across all hunks. */
export declare function mapPatchLines(patch: string): PatchLine[];
/**
 * True when `line` points at a line the PR touched on the new side
 * (an addition or a context line inside a hunk — both are commentable).
 */
export declare function isChangedLine(patch: string, line: number): boolean;
//# sourceMappingURL=diff.d.ts.map