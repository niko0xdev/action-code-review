import { appendFileSync } from 'node:fs';

import * as core from '@actions/core';

export type ProgressPhase =
	| 'fetch'
	| 'filter'
	| 'profiles'
	| 'harness'
	| 'publish';

export function trackPhase(
	phase: ProgressPhase,
	detail: string,
	options: { enabled: boolean }
): void {
	if (!options.enabled) return;
	const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
	const line = `**[progress]** ${phase}: ${detail}\n`;
	core.info(line.trim());
	if (!stepSummaryPath) return;
	try {
		appendFileSync(stepSummaryPath, line, 'utf8');
	} catch (error) {
		core.warning(
			`[progress] write to $GITHUB_STEP_SUMMARY failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export function writeSummaryBlock(
	title: string,
	lines: string[],
	options: { enabled: boolean }
): void {
	if (!options.enabled) return;
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (!summaryPath) return;
	const block = `## ${title}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
	try {
		appendFileSync(summaryPath, block, 'utf8');
	} catch {}
}
