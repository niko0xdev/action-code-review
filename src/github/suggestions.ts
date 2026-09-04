import type { Finding } from '../types/finding.js';

/**
 * GitHub suggested-changes rendering (spec §20). Suggestions are only
 * emitted for small, high-confidence replacements — never for large
 * architectural rewrites.
 */

/** Max replacement size (lines) eligible for a ```suggestion``` block. */
export const MAX_SUGGESTION_LINES = 10;
/** Max replacement size (characters) eligible for a suggestion block. */
export const MAX_SUGGESTION_CHARS = 400;

/**
 * Render the finding's replacement as a GitHub suggestion block, or
 * undefined when the replacement is missing or too large.
 */
export function buildSuggestion(finding: Finding): string | undefined {
	const replacement = finding.replacement;
	if (!replacement || typeof replacement !== 'string') {
		return undefined;
	}
	if (!replacement.trim()) {
		return undefined;
	}
	if (finding.confidence < 0.85) {
		return undefined;
	}
	const lines = replacement.split('\n');
	if (
		lines.length > MAX_SUGGESTION_LINES ||
		replacement.length > MAX_SUGGESTION_CHARS
	) {
		return undefined;
	}
	return ['```suggestion', ...lines, '```'].join('\n');
}
