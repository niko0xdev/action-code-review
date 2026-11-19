import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';

import type { Finding } from '../types/finding.js';

/**
 * The buffer holds finding text, so it lives in the runner's per-job temp
 * directory (emptied after every job) rather than a shared `/tmp` file that
 * accumulates across jobs and repositories on self-hosted runners.
 */
export function defaultBufferPath(
	env: NodeJS.ProcessEnv = process.env
): string {
	return (
		env.AI_INLINE_BUFFER_PATH ??
		join(env.RUNNER_TEMP || tmpdir(), 'ai-inline-buffer.jsonl')
	);
}

export const BUFFER_PATH = defaultBufferPath();

export type BufferedFinding = Finding & {
	ts: string;
	confirmed?: boolean;
};

const TEST_PROBE_RE =
	/^(test comment|testing if|can i|does this work|checking if)/i;

function isTestProbe(body: string): boolean {
	const trimmed = body.trim();
	if (!trimmed) return true;
	return TEST_PROBE_RE.test(trimmed);
}

export function appendToBuffer(findings: BufferedFinding[]): void {
	if (findings.length === 0) return;
	const lines = `${findings.map((f) => JSON.stringify(f)).join('\n')}\n`;
	appendFileSync(BUFFER_PATH, lines, 'utf8');
}

export function classifyFindings(findings: BufferedFinding[]): {
	real: BufferedFinding[];
	probe: BufferedFinding[];
} {
	const neverPost = findings.filter((f) => f.confirmed === false);
	const candidates = findings.filter((f) => f.confirmed !== false);

	if (neverPost.length > 0) {
		core.info(
			`[buffer] ${neverPost.length} with confirmed=false — not posting`
		);
	}

	if (candidates.length === 0) return { real: [], probe: neverPost };

	const real: BufferedFinding[] = [];
	const probe: BufferedFinding[] = [...neverPost];

	for (const f of candidates) {
		const body = `${f.title} ${f.description}`.trim();
		// The title heuristic is only a noise filter: a real issue can start
		// with "Checking if…", so anything at medium severity or above is
		// always posted and always counts towards blocking.
		if (f.severity === 'low' && (isTestProbe(body) || isTestProbe(f.title))) {
			probe.push(f);
		} else {
			real.push(f);
		}
	}

	return { real, probe };
}
