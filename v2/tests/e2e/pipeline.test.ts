import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixtureRepos: string[] = [];
import { prioritizeFiles } from '../../src/context/files.js';
import type { OctokitLike } from '../../src/context/pr.js';
import { fetchPrContext } from '../../src/context/pr.js';
import {
	buildReviewPayload,
	buildSummaryBody,
} from '../../src/github/review.js';
import { resolveProfiles, rulesForProfiles } from '../../src/profiles/index.js';
import { runReview } from '../../src/review/reviewer.js';

/**
 * End-to-end pipeline test: a fixture repo with an intentional defect,
 * a scripted harness (stands in for the Pi child process), and a fake
 * octokit. Verifies the full flow:
 * context → profiles → review → validate/dedupe/cap → GitHub payloads.
 */

function makeFixtureRepo(): string {
	const scratchRoot = mkdtempSync(join(tmpdir(), 'acr-v2-e2e-'));
	fixtureRepos.push(scratchRoot);
	mkdirSync(join(scratchRoot, 'src'), { recursive: true });
	mkdirSync(join(scratchRoot, 'python'), { recursive: true });
	writeFileSync(
		join(scratchRoot, 'pyproject.toml'),
		'[project]\nname = "fixture"\n'
	);
	writeFileSync(join(scratchRoot, 'python', 'main.py'), 'print(1)');
	writeFileSync(join(scratchRoot, 'tsconfig.json'), '{}');
	writeFileSync(
		join(scratchRoot, 'src', 'types.ts'),
		'export type ID = string;'
	);
	writeFileSync(join(scratchRoot, 'uv.lock'), '');
	mkdirSync(join(scratchRoot, 'src'), { recursive: true });
	writeFileSync(
		join(scratchRoot, 'package.json'),
		JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } })
	);
	// Intentional tenant-isolation defect the fake reviewer will report.
	writeFileSync(
		join(scratchRoot, 'src', 'user.service.ts'),
		[
			'export class UserService {',
			'  async getUser(id: string) {',
			'    return this.repo.findOne({ where: { id } }); // missing tenantId',
			'  }',
			'}',
		].join('\n')
	);
	return scratchRoot;
}

const FIXTURE_PATCH = [
	'@@ -1,5 +1,6 @@',
	' export class UserService {',
	'   async getUser(id: string) {',
	'+     // newly added line with the query below',
	'     return this.repo.findOne({ where: { id } });',
	'   }',
	' }',
].join('\n');

function makeOctokit(files: unknown[]): {
	octokit: OctokitLike;
	posted: Record<string, unknown>[];
} {
	const posted: Record<string, unknown>[] = [];
	const octokit = {
		rest: {
			pulls: {
				get: async () => ({
					data: {
						number: 12,
						title: 'Add user lookup',
						body: '',
						draft: false,
						head: { ref: 'feat-lookup', sha: 'headsha' },
						base: { ref: 'main', sha: 'basesha' },
						user: { login: 'dev' },
					},
				}),
				listFiles: async () => ({ data: files }),
			},
		},
	} as unknown as OctokitLike;
	void posted;
	return { octokit, posted };
}

const HARNESS_OUTPUT = JSON.stringify({
	findings: [
		{
			severity: 'high',
			confidence: 0.93,
			category: 'security',
			path: 'src/user.service.ts',
			line: 4,
			title: 'Tenant constraint missing in user lookup',
			description: 'The new query filters only by id.',
			impact: 'Cross-tenant record access if ids are guessable.',
			suggestion: 'Include tenantId in the where clause.',
			replacement: 'return this.repo.findOne({ where: { id, tenantId } });',
		},
		{
			severity: 'low',
			confidence: 0.55,
			category: 'maintainability',
			path: 'src/user.service.ts',
			line: 99, // not touched by the PR — validator must drop
			title: 'Consider splitting service',
			description: 'Large file.',
			impact: 'Maintainability.',
		},
	],
	summary: 'One tenant-isolation issue introduced by this PR.',
	risk: 'high',
});

afterEach(() => {
	for (const repo of fixtureRepos.splice(0))
		rmSync(repo, { recursive: true, force: true });
});

describe('end-to-end review pipeline', () => {
	it('runs context → profiles → review → validation → publish payloads', async () => {
		const fixtureRepo = makeFixtureRepo();

		// 1. Context from the (fake) GitHub API
		const { octokit } = makeOctokit([
			{
				filename: 'src/user.service.ts',
				status: 'modified',
				additions: 2,
				deletions: 0,
				changes: 2,
				patch: FIXTURE_PATCH,
			},
			{
				filename: 'pnpm-lock.yaml',
				status: 'modified',
				additions: 100,
				deletions: 50,
				changes: 150,
				patch: undefined,
			},
		]);
		const context = await fetchPrContext(
			octokit,
			{ owner: 'acme', repo: 'widget' },
			12
		);
		context.repositoryPath = fixtureRepo;

		// Lockfile must not consume review context (spec §32)
		const reviewable = prioritizeFiles(context.diff.files, 10);
		expect(reviewable.map((f) => f.filename)).toEqual(['src/user.service.ts']);

		// 2. Profiles detected from the fixture repo
		const profiles = resolveProfiles(fixtureRepo, 'auto');
		expect(profiles.map((p) => p.id)).toContain('nestjs');
		expect(profiles.map((p) => p.id)).toContain('nodejs');
		expect(rulesForProfiles(profiles)).toContain('tenant isolation');

		// 3. Harness stand-in returns candidate findings incl. one invalid
		let receivedContextPaths: string[] = [];
		const harness = {
			name: 'scripted-harness',
			async review(groupContext: typeof context) {
				receivedContextPaths = groupContext.diff.files.map((f) => f.filename);
				return {
					findings: JSON.parse(HARNESS_OUTPUT).findings,
					summary: JSON.parse(HARNESS_OUTPUT).summary,
					risk: 'high' as const,
					counts: { critical: 0, high: 2, medium: 0, low: 0 },
					filesReviewed: groupContext.diff.files.map((f) => f.filename),
				};
			},
		};

		const result = await runReview({ ...context, profiles }, harness as never, {
			maxFilesPerGroup: 10,
		});

		// The harness saw only reviewable files
		expect(receivedContextPaths).toEqual(['src/user.service.ts']);

		// 4. Validation kept the valid finding, dropped the bad anchor + low confidence
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].title).toBe(
			'Tenant constraint missing in user lookup'
		);

		// 5. Publish payloads are GitHub-shaped
		const payload = buildReviewPayload(
			result.findings,
			context.pullRequest.headSha,
			{
				blockOnIssues: true,
			}
		);
		expect(payload.event).toBe('REQUEST_CHANGES');
		expect(payload.comments[0]).toMatchObject({
			path: 'src/user.service.ts',
			line: 4,
			side: 'RIGHT',
		});
		expect(payload.comments[0].body).toContain('ai-review-id:');
		expect(payload.comments[0].body).toContain('```suggestion');

		const summary = buildSummaryBody({
			...result,
			filesReviewed: result.filesReviewed,
		});
		expect(summary).toContain('AI Code Review');
		expect(summary).toContain('**Risk:** High');
		expect(summary).toContain('High: 1');
	});
});
