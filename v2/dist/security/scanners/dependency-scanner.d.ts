import type { SecurityFinding } from '../types.js';
/**
 * Deterministic supply-chain dependency scanner.
 */
export declare function scanDependenciesInDiff(changedFiles: Array<{
    filename: string;
    patch?: string;
}>): SecurityFinding[];
//# sourceMappingURL=dependency-scanner.d.ts.map