/**
 * Two-pass verify (V3 Phase 5, decision Q4).
 *
 * After the main review pass, optionally runs a second short LLM call
 * that asks the model to challenge its own high/critical findings.
 * The verify pass is bounded by:
 * - Opt-in via `AI_REVIEW_VERIFY_PASS=true` env var (default false).
 * - Cost ceiling of `AI_REVIEW_VERIFY_BUDGET_USD` (default 0.50 USD).
 * - Skipped when zero high/critical findings (nothing worth verifying).
 *
 * Output: a verified copy of the input findings where each surviving
 * finding has a `verified: true` marker set on its body. Dropped
 * findings are silently removed. Cost is tracked via token estimate
 * (input + output) using a per-1K-token rate.
 */
const DEFAULT_BUDGET_USD = 0.5;
const DEFAULT_RATE_PER_1K = 0.001;
/**
 * Severities that warrant a verify pass. Lower severities are not
 * worth the cost - the LLM is unlikely to drop low/medium findings
 * anyway, and the cost ceiling is tighter.
 */
const VERIFY_TARGET_SEVERITIES = ['critical', 'high'];
/**
 * Build the verify prompt. The model is asked to challenge each
 * high/critical finding with three yes/no questions. The model must
 * return JSON in the same shape, but each finding either survives
 * (verified) or is dropped.
 */
export function buildVerifyPrompt(highCritical, toolFindings, context) {
    const toolSection = toolFindings.length
        ? `\nStatic analyzer evidence (from V3 Phase 2 prelint):\n${toolFindings
            .slice(0, 30)
            .map((f) => `- [${f.tool}/${f.code}] ${f.path}:${f.line} (${f.severity}) ${f.message}`)
            .join('\n')}\n`
        : '';
    return `You are reviewing your OWN findings from a prior code-review pass.
Your job is to challenge each high-severity finding before it ships to a human reviewer.

PR title: ${context.title}
PR body (truncated): ${context.body.slice(0, 500)}

Candidate findings to verify (${highCritical.length}):
${JSON.stringify(highCritical, null, 2)}
${toolSection}

For each finding, answer 3 questions:
1. Is the file path real (matches one of: ${context.filenames.slice(0, 20).join(', ')})?
2. Is the line number plausible (between 1 and a reasonable file length)?
3. Would a senior engineer agree this is a real bug?

If ALL THREE answers are YES, keep the finding with "verified": true.
Otherwise, DROP the finding from the output.

Return ONLY JSON:
{"findings": [...same shape, with verified:true on each survivor...]}

Do not invent new findings. Do not change severity. Do not change titles.
This pass exists only to catch hallucinated paths/lines and reasoning shortcuts.`;
}
/**
 * Estimate the cost of running the verify pass. Conservative estimate
 * uses input tokens + output budget.
 */
export function estimateCostUsd(inputTokens, outputTokens, ratePer1K) {
    return ((inputTokens + outputTokens) / 1000) * ratePer1K;
}
/**
 * Run the verify pass. Always resolves (never throws). When skipped,
 * returns the input findings unchanged with a skip reason.
 */
export async function runVerifyPass(options) {
    const budgetUsd = options.budgetUsd ?? DEFAULT_BUDGET_USD;
    const ratePer1K = options.ratePer1K ?? DEFAULT_RATE_PER_1K;
    // Filter to high/critical only.
    const highCritical = options.findings.filter((f) => VERIFY_TARGET_SEVERITIES.includes(f.severity));
    if (highCritical.length === 0) {
        return {
            findings: options.findings,
            verifiedCount: 0,
            droppedCount: 0,
            skipped: true,
            skipReason: 'no high/critical findings to verify',
            estimatedCostUsd: 0,
        };
    }
    // Cost gate.
    const estimatedCostUsd = estimateCostUsd(options.inputTokenEstimate, options.outputTokenBudget, ratePer1K);
    if (estimatedCostUsd > budgetUsd) {
        return {
            findings: options.findings,
            verifiedCount: 0,
            droppedCount: 0,
            skipped: true,
            skipReason: `estimated cost $${estimatedCostUsd.toFixed(3)} exceeds budget $${budgetUsd}`,
            estimatedCostUsd,
        };
    }
    const prompt = buildVerifyPrompt(highCritical, options.toolFindings, options.context);
    let raw;
    try {
        raw = await options.verify(prompt);
    }
    catch (error) {
        return {
            findings: options.findings,
            verifiedCount: 0,
            droppedCount: 0,
            skipped: true,
            skipReason: `verify call failed: ${error instanceof Error ? error.message : String(error)}`,
            estimatedCostUsd,
        };
    }
    const parsed = parseVerifyOutput(raw, highCritical);
    // Build verified output: keep highCritical that survived verification,
    // plus all other findings (unchanged).
    const verifiedSet = new Set(parsed.verified.map((f) => identifyFinding(f)));
    const surviving = options.findings.filter((f) => {
        if (!VERIFY_TARGET_SEVERITIES.includes(f.severity))
            return true;
        return verifiedSet.has(identifyFinding(f));
    });
    return {
        findings: surviving,
        verifiedCount: parsed.verified.length,
        droppedCount: highCritical.length - parsed.verified.length,
        skipped: false,
        estimatedCostUsd,
    };
}
/**
 * Stable identity for a finding used to match verify-pass survivors to
 * the original findings list. Uses path + line + category + first 4
 * title words, matching the dedupe key in `dedupe.ts`.
 */
function identifyFinding(finding) {
    const titlePrefix = finding.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, 4)
        .join(' ');
    return [
        finding.path,
        finding.line,
        finding.category,
        finding.ruleId ?? titlePrefix,
    ].join('|');
}
function parseVerifyOutput(raw, expected) {
    // Best-effort JSON extraction. The LLM may include prose; we look for
    // the first {...} block.
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart)
        return { verified: [] };
    let parsed = null;
    try {
        parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    }
    catch {
        return { verified: [] };
    }
    if (!parsed?.findings?.length)
        return { verified: [] };
    // Coerce + filter to verified entries.
    const verified = [];
    const expectedByKey = new Map();
    for (const f of expected)
        expectedByKey.set(identifyFinding(f), f);
    for (const item of parsed.findings) {
        if (!item || item.verified !== true)
            continue;
        // Find original via identity.
        const candidate = {
            ...expected[0],
            ...item,
        };
        const key = identifyFinding(candidate);
        const original = expectedByKey.get(key);
        if (!original)
            continue;
        verified.push(original);
    }
    return { verified };
}
//# sourceMappingURL=verify.js.map