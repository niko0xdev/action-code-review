import type { Finding } from '../types/finding.js';
/**
 * GitHub suggested-changes rendering (spec §20). Suggestions are only
 * emitted for small, high-confidence replacements — never for large
 * architectural rewrites.
 */
/** Max replacement size (lines) eligible for a ```suggestion``` block. */
export declare const MAX_SUGGESTION_LINES = 10;
/** Max replacement size (characters) eligible for a suggestion block. */
export declare const MAX_SUGGESTION_CHARS = 400;
/**
 * Render the finding's replacement as a GitHub suggestion block, or
 * undefined when the replacement is missing or too large.
 */
export declare function buildSuggestion(finding: Finding): string | undefined;
//# sourceMappingURL=suggestions.d.ts.map