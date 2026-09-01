/**
 * PreLint orchestrator (V3 Phase 2).
 *
 * Runs deterministic static-analysis tools (biome, ruff, mypy, swiftlint,
 * ktlint, sqlfluff, semgrep) against the checked-out repository and
 * surfaces their findings as structured `ToolFinding` records. These are
 * NOT published as PR comments directly - they are injected into the LLM
 * review prompt as evidence so the model can confirm, contradict, or
 * extend them with higher-level reasoning.
 *
 * Design decisions (docs/v3-decisions.md):
 * - Q1: bundle biome + ruff, graceful skip for the rest
 * - Q3: toolFindings exposed in summary via collapsible section
 * - Q5: SQL detection already partially handled in Phase 1; this module
 *       trusts the SQL profile to detect SQL files
 *
 * The orchestrator is opt-in via `AI_REVIEW_ENABLE_PRELINT=true` env var
 * (cannot add a new action input - V1 contract is frozen).
 */
import type { ChangedFile } from '../types/context.js';
import type { ToolFinding } from '../types/finding.js';
export interface PrelintOptions {
    /** Repo root path (where the tool runs). */
    repositoryPath: string;
    /** Files changed by the PR (used to scope tool invocations). */
    changedFiles: ChangedFile[];
    /**
     * Optional timeout override. Defaults to 60s per tool. Tools that
     * exceed this are skipped (not failed) and noted in diagnostics.
     */
    timeoutMs?: number;
    /**
     * If set, override the tool list. Useful for testing. Production
     * always uses `defaultTools()`.
     */
    tools?: ToolRunner[];
}
export interface PrelintResult {
    /** Successful findings collected across all tools. */
    findings: ToolFinding[];
    /** Tools that ran successfully. */
    ran: string[];
    /** Tools that were skipped (missing binary, timeout, error). */
    skipped: string[];
}
/**
 * A single static-analysis tool runner. Each runner knows how to:
 * - detect whether its binary is available in the repo
 * - invoke it against the changed files
 * - parse its output into ToolFinding records
 */
export interface ToolRunner {
    /** Identifier surfaced to the LLM (e.g. "biome", "ruff"). */
    readonly id: string;
    /**
     * Whether the tool is usable in this checkout. Should be cheap
     * (file existence check or `command -v` style probe).
     */
    isAvailable(repositoryPath: string): boolean;
    /**
     * Files this tool can analyze. Used to filter `changedFiles`
     * before invoking the tool, so we don't waste time on irrelevant
     * paths (e.g. biome on Python files).
     */
    matches(file: ChangedFile): boolean;
    /**
     * Invoke the tool against the filtered file list. Must resolve
     * with parsed findings even when the tool exited non-zero
     * (lint findings often exit non-zero).
     */
    run(args: {
        repositoryPath: string;
        files: ChangedFile[];
        timeoutMs: number;
    }): Promise<ToolFinding[]>;
}
export declare function findBinary(repositoryPath: string, binary: string): string | null;
export declare function defaultTools(): ToolRunner[];
export declare function runPrelint(options: PrelintOptions): Promise<PrelintResult>;
export declare function renderToolFindingsForPrompt(findings: ToolFinding[], maxLines?: number): string;
//# sourceMappingURL=prelint.d.ts.map