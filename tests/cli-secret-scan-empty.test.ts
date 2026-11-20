import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const token = `ghp_${'Q1w2E3r4'.repeat(5)}`;

vi.mock('@actions/github', () => ({
	context: {
		payload: { pull_request: { number: 7 } },
		repo: { owner: 'acme', repo: 'widget' },
	},
	getOctokit: vi.fn(() => ({})),
}));

vi.mock('../src/context/pr.js', () => ({
	fetchPrContext: vi.fn(async () => ({
		pullRequest: { title: 't', body: '', draft: false, headSha: 'head' },
		diff: {
			files: [
				{
					filename: 'docs/setup.md',
					status: 'modified',
					additions: 1,
					deletions: 0,
					changes: 1,
					patch: `@@ -1,0 +1,1 @@\n+export GH=${token}`,
				},
			],
		},
	})),
}));

const publishReview = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/github/review.js', async (original) => ({
	...(await original<typeof import('../src/github/review.js')>()),
	publishReview,
}));

import { main } from '../src/cli.js';

describe('main: secret scan on a docs-only pull request', () => {
	const saved = process.env.GITHUB_EVENT_NAME;
	beforeEach(() => {
		process.env.GITHUB_EVENT_NAME = 'pull_request';
		vi.spyOn(core, 'notice').mockImplementation(() => {});
		vi.spyOn(core, 'warning').mockImplementation(() => {});
		vi.spyOn(core, 'info').mockImplementation(() => {});
		vi.spyOn(core.summary, 'addRaw').mockReturnValue(core.summary);
		vi.spyOn(core.summary, 'write').mockResolvedValue(core.summary);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		publishReview.mockClear();
		if (saved === undefined)
			Reflect.deleteProperty(process.env, 'GITHUB_EVENT_NAME');
		else process.env.GITHUB_EVENT_NAME = saved;
	});

	const inputs = (secretScan: string) => (name: string) =>
		name === 'github-token' || name === 'openai-api-key'
			? 'tok'
			: name === 'secret-scan'
				? secretScan
				: '';

	it('publishes secret findings even though no file is selected for review', async () => {
		vi.spyOn(core, 'getInput').mockImplementation(inputs('true'));
		const setOutput = vi.spyOn(core, 'setOutput').mockImplementation(() => {});
		await main(['pr-review']);
		expect(publishReview).toHaveBeenCalledTimes(1);
		const params = (publishReview.mock.calls[0] as unknown[])[1] as {
			result: { findings: Array<{ path: string; severity: string }> };
		};
		expect(params.result.findings).toEqual([
			expect.objectContaining({ path: 'docs/setup.md', severity: 'critical' }),
		]);
		expect(JSON.stringify(params)).not.toContain(token);
		expect(setOutput).toHaveBeenCalledWith(
			'review-summary',
			expect.stringContaining('secret scan')
		);
	});

	it('keeps the plain skip when the scan is off', async () => {
		vi.spyOn(core, 'getInput').mockImplementation(inputs(''));
		const setOutput = vi.spyOn(core, 'setOutput').mockImplementation(() => {});
		await main(['pr-review']);
		expect(publishReview).not.toHaveBeenCalled();
		expect(setOutput).toHaveBeenCalledWith(
			'review-summary',
			'skipped: no files to review'
		);
	});
});
