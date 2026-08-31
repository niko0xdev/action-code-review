/**
 * Normalized finding model used across the V2 review pipeline.
 *
 * Every harness (Pi, future alternatives) must map its output into this
 * format before validation and publishing. See docs/v2-design-spec.md §17.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type FindingCategory =
	| 'correctness'
	| 'security'
	| 'regression'
	| 'error-handling'
	| 'data-integrity'
	| 'concurrency'
	| 'performance'
	| 'maintainability'
	| 'testing'
	| 'compatibility';

export interface Finding {
	/** Impact rank. Drives publish priority and blocking decisions. */
	severity: Severity;
	/** Reviewer confidence in [0, 1]. Findings below min-confidence are dropped. */
	confidence: number;
	category: FindingCategory;
	/** Repository-relative path of the file the finding targets. */
	path: string;
	/**
	 * 1-based line number in the post-change ("RIGHT") side of the diff.
	 * Must point at a line changed by the PR to be publishable inline.
	 */
	line: number;
	title: string;
	/** Stable rule identifier used for cross-run comment identity. */
	ruleId?: string;
	description: string;
	/** Concrete consequence if left unaddressed. */
	impact: string;
	/** Recommended fix, in prose. */
	suggestion?: string;
	/**
	 * Full replacement code for the targeted lines. When present and small,
	 * the publisher renders it as a GitHub ```suggestion``` block.
	 */
	replacement?: string | null;
}

export interface FindingCounts {
	critical: number;
	high: number;
	medium: number;
	low: number;
}

export interface ReviewResult {
	/** Findings that survived validation, sorted by severity then confidence. */
	findings: Finding[];
	/** Human-readable PR summary body (markdown). */
	summary: string;
	/** Overall risk derived from severity distribution. */
	risk: RiskLevel;
	counts: FindingCounts;
	/** Files actually included in the review pass. */
	filesReviewed: string[];
}

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export const SEVERITY_ORDER: Record<Severity, number> = {
	critical: 3,
	high: 2,
	medium: 1,
	low: 0,
};

/** Per-severity publish caps plus the overall cap (spec §19). */
export const FINDING_LIMITS: Record<Severity, number> & { overall: number } = {
	critical: 10,
	high: 10,
	medium: 10,
	low: 5,
	overall: 20,
};
