import type { ChangedFile } from '../types/context.js';
/**
 * Default ignore rules (spec §32). Generated artifacts, snapshots,
 * lockfiles and vendor code never consume review context. Dependency
 * manifests stay reviewable even though lockfiles do not.
 */
export declare const DEFAULT_IGNORE_PATTERNS: RegExp[];
export declare function isLockfile(path: string): boolean;
export declare function isReviewable(file: ChangedFile): boolean;
/**
 * Filter to reviewable files, then keep the highest-impact ones when the
 * count exceeds the cap (spec §31: prioritize source over generated).
 */
export declare function prioritizeFiles(files: ChangedFile[], maxFiles: number): ChangedFile[];
//# sourceMappingURL=files.d.ts.map