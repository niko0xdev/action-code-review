import { appendFileSync } from 'node:fs';
import * as core from '@actions/core';
export function trackPhase(phase, detail, options) {
    if (!options.enabled)
        return;
    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    const line = `**[progress]** ${phase}: ${detail}\n`;
    core.info(line.trim());
    if (!stepSummaryPath)
        return;
    try {
        appendFileSync(stepSummaryPath, line, 'utf8');
    }
    catch (error) {
        core.warning(`[progress] write to $GITHUB_STEP_SUMMARY failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export function writeSummaryBlock(title, lines, options) {
    if (!options.enabled)
        return;
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath)
        return;
    const block = `## ${title}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
    try {
        appendFileSync(summaryPath, block, 'utf8');
    }
    catch { }
}
//# sourceMappingURL=progress.js.map