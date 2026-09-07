import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackPhase } from '../../src/github/progress.js';

const savedSummary = process.env.GITHUB_STEP_SUMMARY;

function clearSummaryEnv(): void {
	// biome-ignore lint/performance/noDelete: restoring pre-test env state
	delete process.env.GITHUB_STEP_SUMMARY;
}

afterEach(() => {
	if (savedSummary === undefined) clearSummaryEnv();
	else process.env.GITHUB_STEP_SUMMARY = savedSummary;
	vi.restoreAllMocks();
});

describe('trackPhase', () => {
	it('does nothing when disabled', () => {
		const info = vi.spyOn(core, 'info').mockImplementation(() => {});
		clearSummaryEnv();
		trackPhase('fetch', 'PR #1', { enabled: false });
		expect(info).not.toHaveBeenCalled();
	});

	it('logs and appends the phase line to the step summary', () => {
		const dir = mkdtempSync(join(tmpdir(), 'acr-progress-'));
		try {
			const file = join(dir, 'summary.md');
			process.env.GITHUB_STEP_SUMMARY = file;
			const info = vi.spyOn(core, 'info').mockImplementation(() => {});
			trackPhase('publish', 'review published', { enabled: true });
			expect(info).toHaveBeenCalledWith(
				'**[progress]** publish: review published'
			);
			expect(readFileSync(file, 'utf8')).toContain(
				'**[progress]** publish: review published'
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('warns instead of throwing when the summary write fails', () => {
		process.env.GITHUB_STEP_SUMMARY = join(
			tmpdir(),
			'acr-no-such-dir',
			'summary.md'
		);
		const warning = vi.spyOn(core, 'warning').mockImplementation(() => {});
		vi.spyOn(core, 'info').mockImplementation(() => {});
		expect(() => trackPhase('fetch', 'PR #1', { enabled: true })).not.toThrow();
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining('[progress] write to $GITHUB_STEP_SUMMARY failed')
		);
	});
});
