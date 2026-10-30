import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('main: empty file selection', () => {
	afterEach(() => {
		vi.restoreAllMocks();
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
