import { describe, expect, it, vi } from 'vitest';
import {
	buildFindingBody,
	buildJobSummary,
	buildReviewPayload,
	buildSummaryBody,
	publishReview,
} from '../../src/github/review.js';
import { buildSuggestion } from '../../src/github/suggestions.js';
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

describe('buildSuggestion', () => {
	it('renders a fenced suggestion block for small replacements', () => {
		const block = buildSuggestion(
			finding({ replacement: 'findOne({ id, tenantId })' })
		);
		expect(block).toContain('```suggestion');
		expect(block).toContain('findOne({ id, tenantId })');
	});

	it('returns undefined for large replacements', () => {
		const big = finding({
			replacement: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
		});
		expect(buildSuggestion(big)).toBeUndefined();
	});

	it('returns undefined when no replacement exists', () => {
		expect(buildSuggestion(finding())).toBeUndefined();
	});
});

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
});
