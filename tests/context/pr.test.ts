import { describe, expect, it, vi } from 'vitest';
import { fetchPrContext } from '../../src/context/pr.js';
import type { OctokitLike } from '../../src/context/pr.js';

function makeOctokit(
	files: unknown[],
	pr?: Record<string, unknown>
): {
	octokit: OctokitLike;
	calls: string[];
} {
	const calls: string[] = [];
	const octokit = {
		rest: {
			pulls: {
				get: vi.fn(async () => {
					calls.push('pulls.get');
					return { data: pr ?? defaultPr() };
				}),
				listFiles: vi.fn(async ({ page }: { page?: number }) => {
					calls.push(`listFiles:${page ?? 1}`);
					return { data: page === 1 ? files : [] };
				}),
			},
		},
	} as unknown as OctokitLike;
	return { octokit, calls };
}

function defaultPr(): Record<string, unknown> {
	return {
		number: 5,
		title: 'Add feature',
		body: 'Implements the thing',
		draft: false,
		head: { ref: 'feat', sha: 'headsha' },
		base: { ref: 'main', sha: 'basesha' },
		user: { login: 'alice' },
	};
}

describe('fetchPrContext', () => {
	it('collects repository, PR metadata and changed files', async () => {
		const { octokit } = makeOctokit([
			{
				filename: 'src/a.ts',
				status: 'modified',
				additions: 3,
				deletions: 1,
				changes: 4,
				patch: '@@ -1 +1 @@\n-a\n+b',
			},
		]);
		const context = await fetchPrContext(
			octokit,
			{ owner: 'acme', repo: 'widget' },
			5
		);
		expect(context.repository).toEqual({ owner: 'acme', repo: 'widget' });
		expect(context.pullRequest.number).toBe(5);
		expect(context.pullRequest.headSha).toBe('headsha');
		expect(context.diff.files[0].filename).toBe('src/a.ts');
	});

	it('paginates listFiles until an empty page', async () => {
		const { octokit, calls } = makeOctokit(
			Array.from({ length: 30 }, (_, i) => ({
				filename: `f${i}.ts`,
				status: 'modified',
				additions: 1,
				deletions: 0,
				changes: 1,
			}))
		);
		const context = await fetchPrContext(
			octokit,
			{ owner: 'o', repo: 'r' },
			1,
			{ pageSize: 30 }
		);
		expect(calls).toContain('listFiles:2');
		expect(context.diff.files.length).toBe(30);
	});

	it('sums additions and deletions across files', async () => {
		const { octokit } = makeOctokit([
			{
				filename: 'a.ts',
				status: 'modified',
				additions: 10,
				deletions: 2,
				changes: 12,
			},
			{
				filename: 'b.ts',
				status: 'added',
				additions: 5,
				deletions: 0,
				changes: 5,
			},
		]);
		const context = await fetchPrContext(octokit, { owner: 'o', repo: 'r' }, 1);
		expect(context.diff.totalAdditions).toBe(15);
		expect(context.diff.totalDeletions).toBe(2);
	});

	it('retries rate-limited file pages', async () => {
		let calls = 0;
		const { octokit } = makeOctokit([]);
		octokit.rest.pulls.listFiles = vi.fn(async () => {
			calls += 1;
			if (calls === 1) throw { status: 429 };
			return { data: [] };
		});
		await fetchPrContext(octokit, { owner: 'o', repo: 'r' }, 1);
		expect(calls).toBe(2);
	});
});
