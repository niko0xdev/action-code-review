/**
 * Normalized finding model used across the V2 review pipeline.
 *
 * Every harness (Pi, future alternatives) must map its output into this
 * format before validation and publishing. See docs/v2-design-spec.md §17.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type FindingCategory = 'correctness' | 'security' | 'regression' | 'error-handling' | 'data-integrity' | 'concurrency' | 'performance' | 'maintainability' | 'testing' | 'compatibility';
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
    /** Static-analyzer findings surfaced as evidence for the LLM review. */
    toolFindings?: ToolFinding[];
    /** Diagnostics about the review pipeline (counts, dropped findings, etc). */
    diagnostics?: ReviewDiagnostics;
    /** Rule-level pass/fail coverage, derived deterministically from profiles + findings. */
    ruleCoverage?: RuleCoverage;
}
export interface RuleCoverage {
    total: number;
    passed: number;
    failedRules: string[];
}
/**
 * A single finding emitted by a deterministic static-analysis tool
 * (biome, ruff, mypy, swiftlint, ktlint, sqlfluff, semgrep, ...).
 * These are NOT published as PR comments directly - they are injected
 * into the LLM review prompt as evidence so the model can confirm,
 * contradict, or extend them with higher-level reasoning.
 */
export interface ToolFinding {
    /** Identifier of the static-analysis tool (e.g. "biome", "ruff"). */
    tool: string;
    /** Stable rule code from the tool (e.g. "B904", "no-unused-vars"). */
    code: string;
    /** Path of the file the finding targets (relative to repo root). */
    path: string;
    /** 1-based line number in the file (post-change side if applicable). */
    line: number;
    /** Tool-assigned severity - mapped to our severity scale on ingestion. */
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    /** Short message from the tool describing the issue. */
    message: string;
    /** Optional tool-specific rule documentation URL. */
    docUrl?: string;
}
/**
 * Diagnostics about the review pipeline (not published inline, surfaced
 * only in tool output / job summary for debugging).
 */
export interface ReviewDiagnostics {
    /** Number of tool findings emitted across all tools. */
    toolFindingsTotal?: number;
    /** Number of LLM findings dropped because the category was unknown. */
    bucketedUnknownCategories?: number;
    /** Number of cross-finding pairs where the lower-confidence side was dropped. */
    crossFindingConflictsResolved?: number;
    /** True when the trivial-PR fast-path was applied (caps to top-3 findings). */
    trivialPrFastPath?: boolean;
    /** Tools that were requested but skipped (missing binary, timeout, ...). */
    prelintSkipped?: string[];
    /** Tools that ran successfully (zero or more findings each). */
    prelintRan?: string[];
    /** Number of review groups that failed (outage/parse failure). Non-zero blocks auto-approval. */
    failedGroups?: number;
}
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';
export declare const SEVERITY_ORDER: Record<Severity, number>;
/** Per-severity publish caps plus the overall cap (spec §19). */
export declare const FINDING_LIMITS: Record<Severity, number> & {
    overall: number;
};
//# sourceMappingURL=finding.d.ts.map