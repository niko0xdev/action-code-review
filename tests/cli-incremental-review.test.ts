import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prFiles = [
	{
		filename: 'src/a.ts',
		status: 'modified' as const,
		additions: 1,
		deletions: 0,
		changes: 1,
		patch: '@@ -1,0 +1,1 @@\n+const a = 1;',
	},
	{
		filename: 'src/b.ts',
		status: 'modified' as const,
		additions: 1,
		deletions: 0,
		changes: 1,
		patch: '@@ -1,0 +1,1 @@\n+const b = 2;',
	},
];

const compareCommits = vi.hoisted(() =>
	vi.fn(async () => ({ data: {} as { status?: string; files?: unknown[] } }))
);

vi.mock('@actions/github', () => ({
	context: {
		payload: { pull_request: { number: 7 } },
		repo: { owner: 'acme', repo: 'widget' },
	},
	getOctokit: vi.fn(() => ({
		rest: { repos: { compareCommitsWithBasehead: compareCommits } },
	})),
}));

vi.mock('../src/context/pr.js', () => ({
	fetchPrContext: vi.fn(async () => ({
		pullRequest: {
			title: 't',
			body: '',
			draft: false,
			headSha: 'b'.repeat(40),
			baseSha: 'a'.repeat(40),
		},
		diff: { files: prFiles },
	})),
}));

const publishReview = vi.hoisted(() => vi.fn(async () => {}));
const readStoredLedger = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/adapter/runtime.js', () => ({
	preparePiRuntimeConfig: vi.fn(async () => ({
		configDir: '/tmp/pi-config',
		cleanup: vi.fn(async () => {}),
	})),
}));

vi.mock('../src/harness/pi.js', async (importOriginal) => {
	const original =
		await importOriginal<typeof import('../src/harness/pi.js')>();
	class FakeHarness {
		runs = [];
	}
	return { ...original, PiHarness: FakeHarness };
});

const runReview = vi.hoisted(() =>
	vi.fn(async () => ({
		findings: [],
		summary: '',
		risk: 'low',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: [] as string[],
		reviewStatus: 'complete',
	}))
);
vi.mock('../src/review/reviewer.js', () => ({ runReview }));

vi.mock('../src/github/review.js', async (original) => ({
	...(await original<typeof import('../src/github/review.js')>()),
	publishReview,
	readStoredLedger,
}));

import { main } from '../src/cli.js';

describe('main: incremental review', () => {
	const saved = process.env.GITHUB_EVENT_NAME;
	beforeEach(() => {
		process.env.GITHUB_EVENT_NAME = 'pull_request';
		vi.spyOn(core, 'notice').mockImplementation(() => {});
		vi.spyOn(core, 'warning').mockImplementation(() => {});
		vi.spyOn(core, 'info').mockImplementation(() => {});
		vi.spyOn(core.summary, 'addRaw').mockReturnValue(core.summary);
		vi.spyOn(core.summary, 'write').mockResolvedValue(core.summary);
		vi.spyOn(core, 'setFailed').mockImplementation((message: string) => {
			throw new Error(`setFailed: ${message}`);
		});
		runReview.mockImplementation(
			async (context: { diff?: { files?: { filename: string }[] } }) => ({
				findings: [],
				summary: '',
				risk: 'low',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: (context.diff?.files ?? []).map((file) => file.filename),
				reviewStatus: 'complete',
			})
		);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		publishReview.mockClear();
		readStoredLedger.mockClear();
		runReview.mockClear();
		compareCommits.mockClear();
		if (saved === undefined)
			Reflect.deleteProperty(process.env, 'GITHUB_EVENT_NAME');
		else process.env.GITHUB_EVENT_NAME = saved;
	});

	const inputs = (incremental: string) => (name: string) =>
		name === 'github-token' || name === 'openai-api-key'
			? 'tok'
			: name === 'incremental-review'
				? incremental
				: '';

	it('keeps the whole scope when the option is off', async () => {
		vi.spyOn(core, 'getInput').mockImplementation(inputs('false'));
		await main(['pr-review']);
		expect(readStoredLedger).not.toHaveBeenCalled();
		const params = publishReview.mock.calls.at(-1)?.[1] as {
			result: { filesReviewed: string[] };
		};
		expect(params.result.filesReviewed).toEqual(['src/a.ts', 'src/b.ts']);
	});

	it('reviews only the changed files when the option is on', async () => {
		vi.spyOn(core, 'getInput').mockImplementation(inputs('true'));
		readStoredLedger.mockResolvedValue(
			Buffer.from(
				JSON.stringify({
					v: 1,
					head: 'a'.repeat(40),
					findings: [],
				})
			).toString('base64')
		);
		compareCommits.mockResolvedValue({
			data: { status: 'ahead', files: [{ filename: 'src/b.ts' }] },
		});
		await main(['pr-review']);
		const params = publishReview.mock.calls.at(-1)?.[1] as {
			result: { filesReviewed: string[]; ledger?: { incremental: boolean } };
		};
		expect(params.result.filesReviewed).toEqual(['src/b.ts']);
		expect(params.result.ledger?.incremental).toBe(true);
	});

	it('falls back to the whole scope when the head was force-pushed', async () => {
		vi.spyOn(core, 'getInput').mockImplementation(inputs('true'));
		readStoredLedger.mockResolvedValue(
			Buffer.from(
				JSON.stringify({ v: 1, head: 'a'.repeat(40), findings: [] })
			).toString('base64')
		);
		compareCommits.mockResolvedValue({ data: { status: 'diverged' } });
		await main(['pr-review']);
		const params = publishReview.mock.calls.at(-1)?.[1] as {
			result: { filesReviewed: string[]; ledger?: { incremental: boolean } };
		};
		expect(params.result.filesReviewed).toEqual(['src/a.ts', 'src/b.ts']);
		expect(params.result.ledger?.incremental).toBe(false);
	});

	it('stores the ledger in the summary comment', async () => {
		vi.spyOn(core, 'getInput').mockImplementation(inputs('true'));
		await main(['pr-review']);
		const params = publishReview.mock.calls.at(-1)?.[1] as {
			result: { ledger?: { payload: string; head: string } };
		};
		expect(params.result.ledger?.payload).toBeTruthy();
		expect(params.result.ledger?.head).toBe('b'.repeat(40));
	});
});
