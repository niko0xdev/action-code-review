import { describe, expect, it, vi } from 'vitest';
import { publishSecurityReview } from '../../src/security/reporters/security-publisher.js';
import type { SecurityResult } from '../../src/security/types.js';

const marker = '<!-- nim-security-sticky-summary -->';
function client(author: string, login: string | null = 'review-bot') {
	return {
		rest: {
			pulls: {
				createReview: vi.fn(async () => ({ data: {} })),
				listReviews: vi.fn(async () => ({ data: [{ id: 1 }] })),
				listCommentsForReview: vi.fn(async () => ({
					data: [
						{
							body: '<!-- ai-review-id:security-fingerprint -->',
							user: { login: author },
						},
					],
				})),
			},
			issues: {
				listComments: vi.fn(async () => ({
					data: [{ id: 8, body: marker, user: { login: author } }],
				})),
				updateComment: vi.fn(async () => ({ data: {} })),
				createComment: vi.fn(async () => ({ data: {} })),
			},
		},
		users: {
			getAuthenticated: vi.fn(async () => {
				if (!login) throw new Error('Resource not accessible by integration');
				return { data: { login } };
			}),
		},
	};
}
function result(): SecurityResult {
	return {
		findings: [
			{
				id: 'finding',
				fingerprint: 'security-fingerprint',
				title: 'Missing tenant check',
				severity: 'high',
				confidence: 'high',
				status: 'validated',
				file: 'src/a.ts',
				startLine: 1,
				evidence: [],
				exploitability: 'likely',
			},
		],
		rejectedFindings: [],
		summaryMarkdown: `Security findings\n${marker}`,
		conclusion: {
			risk: 'high',
			publishedFindings: 1,
			validatedFindings: 1,
			rejectedFindings: 0,
			failThresholdReached: true,
			engineStatus: 'success',
			scanners: [],
			domains: [],
			incomplete: false,
		},
		riskClassification: {
			level: 'high',
			reasons: [],
			domains: [],
			changedFiles: ['src/a.ts'],
		},
		scanners: [],
	};
}
async function publish(octokit: ReturnType<typeof client>) {
	await publishSecurityReview(octokit as never, {
		owner: 'acme',
		repo: 'widget',
		prNumber: 1,
		headSha: 'head',
		result: result(),
	});
}
describe('security publisher marker ownership', () => {
	it.each(['outsider', 'other-app[bot]'])(
		'ignores inline and sticky markers authored by %s',
		async (author) => {
			const octokit = client(author);
			await publish(octokit);
			expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
			expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
			expect(octokit.rest.pulls.createReview).toHaveBeenCalledOnce();
		}
	);
	it('reuses only the authenticated publisher markers', async () => {
		const octokit = client('review-bot');
		await publish(octokit);
		expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
			expect.objectContaining({ comment_id: 8 })
		);
		expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
	});
	it.each(['outsider', 'other-app[bot]', 'github-actions[bot]'])(
		'uses workflow identity when login lookup is refused (author=%s)',
		async (author) => {
			const octokit = client(author, null);
			await publish(octokit);
			if (author === 'github-actions[bot]') {
				expect(octokit.rest.issues.updateComment).toHaveBeenCalledOnce();
				expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
			} else {
				expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
				expect(octokit.rest.pulls.createReview).toHaveBeenCalledOnce();
			}
		}
	);
});
