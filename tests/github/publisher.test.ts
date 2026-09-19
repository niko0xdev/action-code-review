import { describe, expect, it, vi } from 'vitest';
import {
	buildFindingBody,
	buildJobSummary,
	buildReviewPayload,
	buildSummaryBody,
	publishReview,
} from '../../src/github/review.js';
import { normalizeCommentId } from '../../src/review/dedupe.js';
import type { Finding, ReviewResult } from '../../src/types/finding.js';

function finding(overrides?: Partial<Finding>): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		path: 'src/a.ts',
		line: 10,
		title: 'Missing tenant filter',
		description: 'The query retrieves the user only by ID.',
		impact: 'Cross-tenant read possible.',
		suggestion: 'Add tenantId to the where clause.',
		replacement: null,
		...overrides,
	};
}

describe('buildFindingBody', () => {
	it('renders severity badge, category, description and impact', () => {
		const body = buildFindingBody(finding());
		expect(body).toContain('🔥 HIGH · Security');
		expect(body).toContain('The query retrieves the user only by ID.');
		expect(body).toContain('Cross-tenant read possible.');
	});

	it('appends the legacy ai-review-id marker', () => {
		const body = buildFindingBody(finding());
		const id = normalizeCommentId(finding());
		expect(body).toContain(`<!-- ai-review-id:${id} -->`);
	});

	it('includes suggestion blocks inside the body', () => {
		const withReplacement = finding({ replacement: 'x = 1;' });
		const body = buildFindingBody(withReplacement);
		expect(body).toContain('```suggestion');
	});
});

describe('buildSummaryBody', () => {
	const result: ReviewResult = {
		findings: [finding()],
		summary: 'One security issue found.',
		risk: 'high',
		counts: { critical: 0, high: 1, medium: 2, low: 1 },
		filesReviewed: ['a.ts', 'b.ts', 'c.ts'],
	};

	it('includes risk, file count, and severity distribution (spec §20/§21)', () => {
		const body = buildSummaryBody(result);
		expect(body).toContain('**Risk:** High');
		expect(body).toContain('**Files reviewed:** 3');
		expect(body.match(/\*\*Reviewed files:\*\*/g) ?? []).toHaveLength(0);
		expect(body).toContain('Critical: 0');
		expect(body).toContain('High: 1');
		expect(body).toContain('Medium: 2');
		expect(body).toContain('Low: 1');
	});

	it('keeps the legacy summary comment recognizable', () => {
		const body = buildSummaryBody(result);
		expect(body).toContain('AI Code Review');
	});
});

describe('buildReviewPayload', () => {
	it('maps findings into GitHub review comments on changed lines', () => {
		const payload = buildReviewPayload(
			[
				finding(),
				finding({ path: 'src/b.ts', line: 3, replacement: 'fix();' }),
			],
			'headsha'
		);
		expect(payload.event).toBe('REQUEST_CHANGES');
		expect(payload.commit_id).toBe('headsha');
		expect(payload.comments[0].path).toBe('src/a.ts');
		expect(payload.comments[0].line).toBe(10);
		expect(payload.comments[0].side).toBe('RIGHT');
	});

	it('uses COMMENT event when blocking is disabled', () => {
		const payload = buildReviewPayload([finding()], 'sha', {
			blockOnIssues: false,
		});
		expect(payload.event).toBe('COMMENT');
	});

	it('produces no event when there are no findings', () => {
		const payload = buildReviewPayload([], 'sha');
		expect(payload.comments).toHaveLength(0);
		expect(payload.event).toBe('COMMENT');
	});

	it('produces the exact wire shape GitHub expects for createReview', () => {
		const payload = buildReviewPayload(
			[finding(), finding({ path: 'src/b.ts', line: 4 })],
			'abc123'
		);
		// Top-level REST fields for POST /pulls/{n}/reviews.
		expect([...Object.keys(payload)].sort()).toEqual(
			['commit_id', 'comments', 'event'].sort()
		);
		expect(payload.commit_id).toBe('abc123');
		for (const comment of payload.comments) {
			// Per-comment REST fields; side must anchor the diff, not the blob.
			expect([...Object.keys(comment)].sort()).toEqual(
				['body', 'line', 'path', 'side'].sort()
			);
			expect(comment.side).toBe('RIGHT');
		}
	});

	it('ends every inline body with the ai-review-id dedupe marker', () => {
		const payload = buildReviewPayload([finding(), finding({ line: 11 })], 's');
		for (const comment of payload.comments) {
			expect(comment.body).toMatch(/<!-- ai-review-id:[a-f0-9]{12} -->$/);
		}
	});

	it('always sets side RIGHT so comments anchor on the diff', () => {
		const payload = buildReviewPayload(
			[
				finding(),
				finding({ path: 'deep/nested/file.tsx' }),
				finding({ replacement: 'const x = 1;' }),
			],
			's'
		);
		expect(payload.comments.every((c) => c.side === 'RIGHT')).toBe(true);
	});
});

describe('publishReview', () => {
	function makeOctokit() {
		return {
			rest: {
				pulls: {
					createReview: vi.fn(async () => ({ data: {} })),
					listThreads: vi.fn(async () => []),
				},
				issues: {
					createComment: vi.fn(async () => ({ data: {} })),
					listComments: vi.fn(async () => ({ data: [] })),
				},
			},
			users: {
				getAuthenticated: vi.fn(async () => ({ data: { login: 'bot' } })),
			},
			paginate: vi.fn(async () => []),
		};
	}

	function makeApprovalOctokit(
		threads: unknown[] = [
			{ resolved: true, comments: [{ user: { login: 'bot' } }] },
		]
	) {
		return {
			rest: {
				pulls: {
					createReview: vi.fn(async () => ({ data: {} })),
					listThreads: vi.fn(async () => threads),
				},
				issues: {
					createComment: vi.fn(async () => ({ data: {} })),
					listComments: vi.fn(async () => ({ data: [] })),
				},
			},
			users: {
				getAuthenticated: vi.fn(async () => ({ data: { login: 'bot' } })),
			},
			paginate: vi.fn(async () => []),
		};
	}

	it('refuses to publish when the PR head changed during review', async () => {
		const octokit = makeOctokit() as any;
		octokit.rest.pulls.get = vi.fn(async () => ({
			data: { head: { sha: 'new-head' } },
		}));
		const result: ReviewResult = {
			findings: [finding()],
			summary: '',
			risk: 'high',
			counts: { critical: 0, high: 1, medium: 0, low: 0 },
			filesReviewed: ['src/a.ts'],
		};
		await publishReview(octokit, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 1,
			headSha: 'old-head',
			result,
		});
		expect(result.reviewStatus).toBe('stale');
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});

	it('posts inline comments and the summary', async () => {
		const octokit = makeOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 5,
			headSha: 'sha1',
			result: {
				findings: [finding()],
				summary: '',
				risk: 'high',
				counts: { critical: 0, high: 1, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
		});
		expect(octokit.rest.pulls.createReview).toHaveBeenCalledOnce();
		expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
	});

	it('forwards filesTotal/filesExcluded into the summary comment', async () => {
		const octokit = makeOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 5,
			headSha: 'sha1',
			result: {
				findings: [],
				summary: 'clean',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			filesTotal: 4,
			filesExcluded: 3,
			blockOnIssues: true,
		});
		const body = octokit.rest.issues.createComment.mock.calls[0][0]
			.body as string;
		expect(body).toContain('**Files reviewed:** 1 of 4 (3 excluded by filter)');
	});

	it('skips posting a review when there are no findings but still summarizes', async () => {
		const octokit = makeOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 5,
			headSha: 'sha1',
			result: {
				findings: [],
				summary: 'clean',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
		});
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
		expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
	});

	it('submits an APPROVE event only when autoApproveWhenResolved and threads resolved', async () => {
		const octokit = makeApprovalOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result: {
				findings: [],
				summary: 'clean',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
			autoApproveWhenResolved: true,
		});
		const callArgs = (
			octokit.rest.pulls.createReview as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(callArgs).toMatchObject({ event: 'APPROVE', pull_number: 7 });
		// APPROVE event MUST NOT carry inline comments — GitHub API rejects
		// `comments` on an APPROVE review.
		expect(callArgs.comments).toBeUndefined();
	});

	it('does not auto-approve when autoApproveWhenResolved is false', async () => {
		const octokit = makeOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result: {
				findings: [],
				summary: 'clean',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
			autoApproveWhenResolved: false,
		});
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});

	it('does not auto-approve when only low-severity findings and resolved threads exist but flag is off', async () => {
		const octokit = makeApprovalOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result: {
				findings: [finding({ severity: 'low' })],
				summary: 'one low',
				risk: 'low',
				counts: { critical: 0, high: 0, medium: 0, low: 1 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
			autoApproveWhenResolved: false,
		});
		expect(octokit.rest.pulls.createReview).toHaveBeenCalledOnce();
		expect(
			(octokit.rest.pulls.createReview as ReturnType<typeof vi.fn>).mock
				.calls[0][0].event
		).toBe('COMMENT');
	});

	it('does not auto-approve when threads are unresolved', async () => {
		const octokit = {
			...makeOctokit(),
			rest: {
				...makeOctokit().rest,
				pulls: {
					...makeOctokit().rest.pulls,
					listThreads: vi.fn(async () => [
						{ resolved: false, comments: [{ user: { login: 'bot' } }] },
					]),
				},
			},
		} as never;
		await publishReview(octokit, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result: {
				findings: [],
				summary: 'clean',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
			autoApproveWhenResolved: true,
		});
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});

	it('honors blockOnIssues=false by posting COMMENT even for blocking findings', async () => {
		const octokit = makeOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 8,
			headSha: 'sha-block-false',
			result: {
				findings: [finding({ severity: 'high' })],
				summary: 'one high',
				risk: 'high',
				counts: { critical: 0, high: 1, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: false,
		});
		const callArgs = (
			octokit.rest.pulls.createReview as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(callArgs.event).toBe('COMMENT');
	});

	it('suppresses approval when review had failed groups', async () => {
		const octokit = makeApprovalOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result: {
				findings: [],
				summary: 'clean',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
				diagnostics: { failedGroups: 1 },
			},
			blockOnIssues: true,
			autoApproveWhenResolved: true,
		});
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});

	it('does not submit APPROVE when a blocking finding is present', async () => {
		const octokit = makeOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 8,
			headSha: 'sha-block',
			result: {
				findings: [finding({ severity: 'high' })],
				summary: 'one high',
				risk: 'high',
				counts: { critical: 0, high: 1, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
		});
		const callArgs = (
			octokit.rest.pulls.createReview as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(callArgs.event).toBe('REQUEST_CHANGES');
	});

	it('logs approval errors via core.warning, not console.warn', async () => {
		const warn = vi.fn();
		const octokit = {
			...makeApprovalOctokit(),
			rest: {
				...makeApprovalOctokit().rest,
				pulls: {
					...makeApprovalOctokit().rest.pulls,
					createReview: vi.fn(async () => {
						throw new Error('GitHub API down');
					}),
					listThreads: vi.fn(async () => [
						{ resolved: true, comments: [{ user: { login: 'bot' } }] },
					]),
				},
				issues: {
					createComment: vi.fn(async () => ({ data: {} })),
					listComments: vi.fn(async () => ({ data: [] })),
				},
			},
		};
		// Spy on core.warning (action runtime). Falls back to no-op if @actions/core
		// mock doesn't expose it; either way the test should not throw.
		const coreMod = await import('@actions/core');
		const spy = vi.spyOn(coreMod, 'warning').mockImplementation(warn);
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 9,
			headSha: 'sha-warn',
			result: {
				findings: [],
				summary: '',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['src/a.ts'],
			},
			blockOnIssues: true,
			autoApproveWhenResolved: true,
		});
		expect(warn).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('approval outcome reporting', () => {
	function cleanResult(): ReviewResult {
		return {
			findings: [],
			summary: 'clean',
			risk: 'none',
			counts: { critical: 0, high: 0, medium: 0, low: 0 },
			filesReviewed: ['src/a.ts'],
		};
	}

	function octokitWithApproval(approve: () => Promise<unknown>) {
		return {
			rest: {
				pulls: {
					createReview: vi.fn(approve),
					listThreads: vi.fn(async () => [
						{ resolved: true, comments: [{ user: { login: 'bot' } }] },
					]),
				},
				issues: {
					createComment: vi.fn(async () => ({ data: {} })),
					listComments: vi.fn(async () => ({ data: [] })),
				},
			},
			users: {
				getAuthenticated: vi.fn(async () => ({ data: { login: 'bot' } })),
			},
			paginate: vi.fn(async () => []),
		};
	}

	it('records approved only after GitHub accepts the APPROVE review', async () => {
		const octokit = octokitWithApproval(async () => ({ data: {} }));
		const result = cleanResult();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: true,
		});
		expect(result.approval).toEqual({ state: 'approved' });
	});

	it('records not-permitted when repository policy rejects the approval (HTTP 422)', async () => {
		const octokit = octokitWithApproval(async () => {
			throw Object.assign(
				new Error('GitHub Actions is not permitted to approve pull requests.'),
				{ status: 422 }
			);
		});
		const result = cleanResult();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: true,
		});
		expect(result.approval?.state).toBe('not-permitted');
		expect(result.approval?.detail).toContain('not permitted');
		// A refused approval is not a failed review: the analysis still stands.
		expect(result.reviewStatus).toBeUndefined();
	});

	it('records failed for an unrelated approval error', async () => {
		const octokit = octokitWithApproval(async () => {
			throw Object.assign(new Error('Bad credentials'), { status: 401 });
		});
		const result = cleanResult();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: true,
		});
		expect(result.approval?.state).toBe('failed');
		expect(result.approval?.detail).toContain('Bad credentials');
	});

	it('records skipped-unresolved-threads without calling the API', async () => {
		const octokit = octokitWithApproval(async () => ({ data: {} }));
		octokit.rest.pulls.listThreads = vi.fn(async () => [
			{ resolved: false, comments: [{ user: { login: 'bot' } }] },
		]);
		const result = cleanResult();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: true,
		});
		expect(result.approval?.state).toBe('skipped-unresolved-threads');
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});

	it('records a write-permission skip when the actor cannot escalate', async () => {
		const octokit = octokitWithApproval(async () => ({ data: {} })) as Record<
			string,
			unknown
		> & { rest: Record<string, unknown> };
		octokit.rest.repos = {
			getCollaboratorPermissionLevel: vi.fn(async () => ({
				data: { permission: 'read' },
			})),
		};
		const result = cleanResult();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: true,
			requireWritePermissions: true,
			actor: 'outsider',
		});
		expect(result.approval?.state).toBe('skipped-no-write-permission');
	});

	it('approves a clean review whose PR has no AI threads at all', async () => {
		// Regression: an empty thread list used to fail closed, so
		// auto-approval never fired for a PR whose review found nothing.
		const octokit = octokitWithApproval(async () => ({ data: {} }));
		octokit.rest.pulls.listThreads = vi.fn(async () => []);
		const result = cleanResult();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: true,
		});
		expect(result.approval).toEqual({ state: 'approved' });
		expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'APPROVE' })
		);
	});

	it('reports the approval outcome in the posted summary, not not-requested', async () => {
		// Regression: the summary was rendered before the approval was
		// resolved, so it always claimed an approval was not requested.
		const octokit = octokitWithApproval(async () => ({ data: {} }));
		octokit.rest.pulls.listThreads = vi.fn(async () => []);
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result: cleanResult(),
			autoApproveWhenResolved: true,
		});
		const body = (
			octokit.rest.issues.createComment as ReturnType<typeof vi.fn>
		).mock.calls.at(-1)?.[0].body as string;
		expect(body).toContain('**Approval:** submitted');
		expect(body).toContain('> ✨ **APPROVED**');
		expect(body).not.toContain('not requested');
	});

	it('reports a refused approval in the posted summary', async () => {
		const octokit = octokitWithApproval(async () => {
			throw Object.assign(
				new Error('GitHub Actions is not permitted to approve pull requests.'),
				{ status: 422 }
			);
		});
		octokit.rest.pulls.listThreads = vi.fn(async () => []);
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result: cleanResult(),
			autoApproveWhenResolved: true,
		});
		const body = (
			octokit.rest.issues.createComment as ReturnType<typeof vi.fn>
		).mock.calls.at(-1)?.[0].body as string;
		expect(body).toContain('APPROVAL NOT PERMITTED');
		expect(body).toContain(
			'Allow GitHub Actions to create and approve pull requests'
		);
	});

	it('records not-requested when the flag is off', async () => {
		const octokit = octokitWithApproval(async () => ({ data: {} }));
		const result = cleanResult();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: false,
		});
		expect(result.approval?.state).toBe('not-requested');
	});

	it('records not-requested on an incomplete review instead of approving', async () => {
		const octokit = octokitWithApproval(async () => ({ data: {} }));
		const result: ReviewResult = {
			...cleanResult(),
			reviewStatus: 'incomplete',
			diagnostics: { failedGroups: 1, filesNotAnalyzed: 3 },
		};
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-approve',
			result,
			autoApproveWhenResolved: true,
		});
		expect(result.approval?.state).toBe('not-requested');
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});
});

describe('buildJobSummary (spec §39)', () => {
	it('exposes duration, files and findings without visible Model line', () => {
		const text = buildJobSummary({
			model: 'gpt-4o-mini',
			durationMs: 61_000,
			filesReviewed: ['a.ts', 'b.ts'],
			result: {
				findings: [finding()],
				summary: '',
				risk: 'high',
				counts: { critical: 0, high: 1, medium: 0, low: 0 },
				filesReviewed: ['a.ts', 'b.ts'],
			},
		});
		expect(text).not.toContain('Model:');
		expect(text).not.toContain('gpt-4o-mini');
		expect(text).toContain('2');
		expect(text).toContain('High');
	});

	it('reports the excluded-files line when filesTotal is supplied', () => {
		const text = buildJobSummary({
			durationMs: 61_000,
			filesReviewed: ['a.ts'],
			filesTotal: 4,
			filesExcluded: 3,
			result: {
				findings: [],
				summary: '',
				risk: 'none',
				counts: { critical: 0, high: 0, medium: 0, low: 0 },
				filesReviewed: ['a.ts'],
			},
		});
		expect(text).toContain('**Files reviewed:** 1 of 4 (3 excluded by filter)');
	});
});
