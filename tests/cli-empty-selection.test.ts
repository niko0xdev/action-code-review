import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actions/github', () => ({
	context: {
		payload: { pull_request: { number: 7 } },
		repo: { owner: 'acme', repo: 'widget' },
	},
	getOctokit: vi.fn(() => ({})),
}));

vi.mock('../src/context/pr.js', () => ({
	fetchPrContext: vi.fn(async () => ({
		pullRequest: { title: 't', body: '', draft: false },
		diff: {
			files: [
				{ filename: 'pnpm-lock.yaml', patch: '@@ -1 +1 @@\n-a\n+b' },
				{ filename: 'README.md', patch: '@@ -1 +1 @@\n-a\n+b' },
			],
		},
	})),
}));

import { main } from '../src/cli.js';

// main() skips any event that is not a pull request, so the tests must set the
// event themselves instead of inheriting it from the runner (CI on a push to
// main would otherwise skip the review and fail these assertions).
const ENV_KEYS = ['GITHUB_EVENT_NAME', 'GITHUB_ACTOR'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

describe('main: empty file selection', () => {
	beforeEach(() => {
		for (const key of ENV_KEYS) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
		process.env.GITHUB_EVENT_NAME = 'pull_request';
	});

	afterEach(() => {
		vi.restoreAllMocks();
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
	});

	it('reports a notice, not a warning, and sets the skipped summary', async () => {
		vi.spyOn(core, 'getInput').mockImplementation((name: string) =>
			name === 'github-token' || name === 'openai-api-key' ? 'tok' : ''
		);
		const notice = vi.spyOn(core, 'notice').mockImplementation(() => {});
		const warning = vi.spyOn(core, 'warning').mockImplementation(() => {});
		const setOutput = vi.spyOn(core, 'setOutput').mockImplementation(() => {});
		await main(['pr-review']);
		expect(notice).toHaveBeenCalledWith(
			expect.stringContaining('No files to review')
		);
		expect(warning).not.toHaveBeenCalledWith(
			expect.stringContaining('No files to review')
		);
		expect(setOutput).toHaveBeenCalledWith(
			'review-summary',
			'skipped: no files to review'
		);
	});

	it('still warns when an include-dir matched nothing', async () => {
		vi.spyOn(core, 'getInput').mockImplementation((name: string) =>
			name === 'github-token' || name === 'openai-api-key'
				? 'tok'
				: name === 'include-dir'
					? 'lib'
					: ''
		);
		const notice = vi.spyOn(core, 'notice').mockImplementation(() => {});
		const warning = vi.spyOn(core, 'warning').mockImplementation(() => {});
		vi.spyOn(core, 'setOutput').mockImplementation(() => {});
		await main(['pr-review']);
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining('No files to review')
		);
		expect(notice).not.toHaveBeenCalled();
	});
});
