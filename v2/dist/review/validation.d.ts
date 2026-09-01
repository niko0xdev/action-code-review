/**
 * Phase 3: Validation hardening (V3 decision Q2 + spec §18 extensions).
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
 * - NEW CHECK 3: Cross-finding consistency. Two findings on the same
 *   `(path, line range of 5)` with the SAME category that give
 *   contradictory advice (one positive, one negative body keywords) get
 *   the lower-confidence one dropped. Implemented as a pairwise scan
 *   after dedupe.
 *
 * All checks operate on the post-validate, post-dedupe finding set so
 * the order in the pipeline stays: validate -> dedupe -> cross-check ->
 * cap -> publish.
 */
import type { Finding, FindingCategory } from '../types/finding.js';
/** Allowed `FindingCategory` vocabulary (mirrors `types/finding.ts`). */
export declare const ALLOWED_CATEGORIES: readonly FindingCategory[];
/**
 * Generic fallback category for bucketed findings. We pick
 * `maintainability` because it has the lowest severity weight and the
 * fewest false-positive implications; the original harness intent is
 * unknown so this is the safest landing spot.
 */
export declare const FALLBACK_CATEGORY: FindingCategory;
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
export declare function normalizeCategories(findings: Finding[]): NormalizeCategoriesResult;
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
export declare function sanitizeReplacements(findings: Finding[]): Finding[];
/**
 * Output of `resolveCrossFindingConflicts` — a deduplicated, conflict-free
 * finding list plus the count of dropped conflicting findings.
 */
export interface CrossCheckResult {
    readonly findings: Finding[];
    readonly droppedCount: number;
}
/**
 * For each `(path, category)` group, scan pairs of findings within a
 * `LINE_PROXIMITY` window of each other. If two findings in the same
 * group contain contradictory advice (one says the code is missing
 * something, the other says it's over-engineered / remove something),
 * keep the higher-confidence one and drop the lower.
 *
 * Heuristic: presence of positive markers ("missing", "add", "should",
 * "required") vs negative markers ("remove", "delete", "unnecessary",
 * "redundant", "over-engineered") in `description` or `title`.
 */
export declare const LINE_PROXIMITY = 5;
export declare function resolveCrossFindingConflicts(findings: Finding[]): CrossCheckResult;
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
export declare const TRIVIAL_DIFF_LINE_THRESHOLD = 5;
export declare const TRIVIAL_MAX_FINDINGS = 3;
export declare function trivialPrFastPath(findings: Finding[], options: {
    totalChanges: number;
    hasTestFileChanges: boolean;
}): FastPathResult;
/** Convenience helper to detect test-file changes by filename. */
export declare function hasTestFileChanges(filenames: string[]): boolean;
//# sourceMappingURL=validation.d.ts.map