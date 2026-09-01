import type { SecurityFinding } from '../types.js';
/**
 * Deterministic secret scanner over diff patches.
 */
export declare function scanSecretsInDiff(changedFiles: Array<{
    filename: string;
    patch?: string;
}>): SecurityFinding[];
//# sourceMappingURL=secret-scanner.d.ts.map