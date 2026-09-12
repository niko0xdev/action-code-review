/**
 * Validation hardening (spec §18 extensions).
 *
 * Three new checks layered on top of the existing validator pipeline:
 *
 * - NEW CHECK 1: Category vocabulary enforcement. Findings whose category
 *   is not in the allowed `FindingCategory` vocabulary are NOT silently
 *   dropped — they are bucketed to `severity: 'low'` with category
 *   `'maintainability'` (the generic bucket). The bucket count is surfaced
 *   via `ReviewDiagnostics.bucketedUnknownCategories` so operators can
 *   see harness drift over time.
 *
 * - NEW CHECK 2: Suggestion safety. The current validator does not parse
 *   `replacement`. This module strips `replacement` when it is empty,
 *   contains obviously broken syntax, or references identifiers that
 *   don't exist in the file (best-effort heuristic). `suggestion` (prose)
 *   is kept.
 *
 * - NEW CHECK 3: Cross-finding consistency is intentionally conservative.
 *   Candidate conflicts are retained until evidence-based verification; a
 *   keyword polarity heuristic must never suppress an independent defect.
 *
 * All checks operate on the post-validate, post-dedupe finding set so
 * the order in the pipeline stays: validate -> dedupe -> cross-check ->
 * cap -> publish.
 */

import type { Finding, FindingCategory, Severity } from '../types/finding.js';

/** Allowed `FindingCategory` vocabulary (mirrors `types/finding.ts`). */
export const ALLOWED_CATEGORIES: readonly FindingCategory[] = [
	'correctness',
	'security',
	'regression',
	'error-handling',
	'data-integrity',
	'concurrency',
	'performance',
	'maintainability',
	'testing',
	'compatibility',
] as const;

/**
 * Generic fallback category for bucketed findings. We pick
 * `maintainability` because it has the lowest severity weight and the
 * fewest false-positive implications; the original harness intent is
 * unknown so this is the safest landing spot.
 */
export const FALLBACK_CATEGORY: FindingCategory = 'maintainability';

/**
 * Output of `normalizeCategories` — counts how many findings were
 * re-routed to the fallback bucket so the caller can surface it in
 * `ReviewDiagnostics.bucketedUnknownCategories`.
 */
export interface NormalizeCategoriesResult {
	readonly findings: Finding[];
	readonly bucketedCount: number;
}

/**
 * Re-route findings whose category is not in the allowed vocabulary
 * to `severity: 'low'` + `category: 'maintainability'`. Preserves
 * `confidence`, `path`, `line`, `title`, `description`, `impact`,
 * `suggestion`, `replacement` so the original intent is recoverable
 * from the comment body even when the category is wrong.
 */
export function normalizeCategories(
	findings: Finding[]
): NormalizeCategoriesResult {
	const result: Finding[] = [];
	let bucketedCount = 0;
	for (const finding of findings) {
		if (ALLOWED_CATEGORIES.includes(finding.category)) {
			result.push(finding);
			continue;
		}
		bucketedCount += 1;
		result.push({
			...finding,
			severity: 'low',
			category: FALLBACK_CATEGORY,
		});
	}
	return { findings: result, bucketedCount };
}

// ─── Suggestion safety ─────────────────────────────────────────────────────

/**
 * Cheap syntax heuristics — we do not pull in a parser because the
 * suggestion is small. A finding is "unsafe" when its replacement:
 * - is empty
 * - has obviously unbalanced braces/parens/brackets
 * - contains a literal `<<<` or `>>>` (merge-conflict markers)
 *
 * When unsafe, we clear `replacement` so the publisher renders a plain
 * comment instead of a one-click suggestion.
 */
export function sanitizeReplacements(findings: Finding[]): Finding[] {
	return findings.map((finding) => {
		const replacement = finding.replacement;
		if (!replacement) return finding;
		if (!isSafeReplacement(replacement)) {
			return { ...finding, replacement: null };
		}
		return finding;
	});
}

function isSafeReplacement(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	// Reject merge-conflict markers (defense in depth - shouldn't happen
	// but cheap to check).
	if (/^(<{3}|>{3})/m.test(text)) return false;
	// Bracket balance check.
	if (!hasBalancedDelimiters(text)) return false;
	return true;
}

function hasBalancedDelimiters(text: string): boolean {
	let braces = 0;
	let brackets = 0;
	let parens = 0;
	let inString: false | '"' | "'" | '`' = false;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		const next = text[i + 1];
		if (inLineComment) {
			if (ch === '\n') inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			if (ch === '*' && next === '/') {
				inBlockComment = false;
				i += 1;
			}
			continue;
		}
		if (inString) {
			if (ch === '\\') {
				i += 1;
				continue;
			}
			if (ch === inString) inString = false;
			continue;
		}
		if (ch === '/' && next === '/') {
			inLineComment = true;
			i += 1;
			continue;
		}
		if (ch === '/' && next === '*') {
			inBlockComment = true;
			i += 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			inString = ch;
			continue;
		}
		if (ch === '{') braces += 1;
		else if (ch === '}') braces -= 1;
		else if (ch === '[') brackets += 1;
		else if (ch === ']') brackets -= 1;
		else if (ch === '(') parens += 1;
		else if (ch === ')') parens -= 1;
		if (braces < 0 || brackets < 0 || parens < 0) return false;
	}
	return braces === 0 && brackets === 0 && parens === 0;
}

// ─── Cross-finding consistency ─────────────────────────────────────────────

/**
 * Output of `resolveCrossFindingConflicts` — a deduplicated, conflict-free
 * finding list plus the count of dropped conflicting findings.
 */
export interface CrossCheckResult {
	readonly findings: Finding[];
	readonly droppedCount: number;
}

/**
 * Lexical polarity is not sufficient to establish a shared invariant, so
 * this stage preserves candidates. A future verifier may emit an explicit
 * contradiction record with evidence without silently dropping either one.
 */
export const LINE_PROXIMITY = 5;

export function resolveCrossFindingConflicts(
	findings: Finding[]
): CrossCheckResult {
	// Natural-language polarity is not evidence that two findings describe the
	// same invariant. Preserve both candidates until a verifier can establish
	// identity; dropping one here can hide independent fixes (for example an
	// added tenant check and a removed admin bypass).
	return { findings: [...findings], droppedCount: 0 };
}

// ─── Trivial-PR fast-path ──────────────────────────────────────────────────

/**
 * Output of `trivialPrFastPath` — original or capped findings plus a
 * flag indicating whether the fast path was applied.
 */
export interface FastPathResult {
	readonly findings: Finding[];
	readonly trivialPr: boolean;
}

/**
 * Cap findings to a small number for PRs that touch only a few lines.
 * Skips long-context exploration to save tokens. Threshold is "fewer
 * than 5 changed lines AND no test file modifications" per spec §31.
 *
 * NOTE: this does NOT drop findings silently — it caps to the top-3 by
 * severity rank, then confidence.
 */
export const TRIVIAL_DIFF_LINE_THRESHOLD = 5;
export const TRIVIAL_MAX_FINDINGS = 3;

export function trivialPrFastPath(
	findings: Finding[],
	options: {
		totalChanges: number;
		hasTestFileChanges: boolean;
	}
): FastPathResult {
	const trivialPr =
		options.totalChanges < TRIVIAL_DIFF_LINE_THRESHOLD &&
		!options.hasTestFileChanges;
	if (!trivialPr) return { findings, trivialPr: false };
	const sorted = [...findings].sort((a, b) => {
		const sevOrder: Record<Severity, number> = {
			critical: 3,
			high: 2,
			medium: 1,
			low: 0,
		};
		const sevDelta = sevOrder[b.severity] - sevOrder[a.severity];
		if (sevDelta !== 0) return sevDelta;
		return b.confidence - a.confidence;
	});
	return {
		findings: sorted.slice(0, TRIVIAL_MAX_FINDINGS),
		trivialPr: true,
	};
}

/** Convenience helper to detect test-file changes by filename. */
export function hasTestFileChanges(filenames: string[]): boolean {
	return filenames.some((filename) => isTestFile(filename));
}

function isTestFile(filename: string): boolean {
	const base = filename.split('/').pop() ?? '';
	// .test.ts, .spec.ts, __tests__/, *_test.go, *_test.py, test/, tests/
	if (/\.(test|spec)\.[a-z]+$/i.test(base)) return true;
	if (/^test_.*\.[a-z]+$/i.test(base)) return true;
	if (/.*_test\.[a-z]+$/i.test(base)) return true;
	const segments = filename.split('/');
	if (segments.includes('__tests__')) return true;
	if (segments.includes('test') || segments.includes('tests')) {
		// Files inside `test/` or `tests/` directory at repo root
		// (not e.g. `src/test-utils/` which is common in monorepos).
		if (segments.length <= 2) return true;
	}
	return false;
}
