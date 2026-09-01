import type { SecurityFinding } from '../types.js';
/**
 * Normalize an untrusted raw object into a validated SecurityFinding.
 * Spec reference: §10.
 */
export declare function normalizeSecurityFinding(raw: unknown, repo?: string, defaultScanner?: string): SecurityFinding | null;
//# sourceMappingURL=normalizer.d.ts.map