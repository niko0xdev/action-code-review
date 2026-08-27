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
		expect(body).toContain('**Reviewed files:** 3');
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
				},
				issues: {
					createComment: vi.fn(async () => ({ data: {} })),
					listComments: vi.fn(async () => ({ data: [] })),
				},
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
});

describe('buildJobSummary (spec §39)', () => {
	it('exposes model, duration, files and findings', () => {
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
		expect(text).toContain('gpt-4o-mini');
		expect(text).toContain('2');
		expect(text).toContain('High');
	});
});
