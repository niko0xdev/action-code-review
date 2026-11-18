import { describe, expect, it, vi } from 'vitest';
import { updatePrContent } from '../../src/github/pr-content.js';

const snapshot = { headSha: 'head-a', title: 'Old', body: 'Old body' };

function octokit(title = 'Old', body = 'Old body') {
	return {
		rest: {
			pulls: {
				get: vi.fn(async () => ({
					data: { title, body, head: { sha: 'head-a' } },
				})),
				listFiles: vi.fn(async () => ({ data: [] })),
				update: vi.fn(async () => ({ data: {} })),
			},
		},
	};
}

describe('updatePrContent', () => {
	it.each([
		['bare JSON', '{"title":"New","description":"Body"}'],
		['fenced JSON', '```json\n{"title":"New","description":"Body"}\n```'],
		['prose JSON', 'Done: {"title":"New","description":"Body"}'],
	])('parses %s and updates PR', async (_name, response) => {
		const client = octokit();
		await updatePrContent(client, 'acme', 'repo', 1, {
			response,
			expectedSnapshot: snapshot,
		});
		expect(client.rest.pulls.update).toHaveBeenCalledWith({
			owner: 'acme',
			repo: 'repo',
			pull_number: 1,
			title: 'New',
			body: 'Body',
		});
	});

	it('does not update unchanged content', async () => {
		const client = octokit('New', 'Body');
		await updatePrContent(client, 'acme', 'repo', 1, {
			expectedSnapshot: { headSha: 'head-a', title: 'New', body: 'Body' },
			response: '{"title":"New","description":"Body"}',
		});
		expect(client.rest.pulls.update).not.toHaveBeenCalled();
	});

	it('rejects truncated JSON for caller retry', async () => {
		await expect(
			updatePrContent(octokit(), 'a', 'r', 1, {
				response: '{"title":"x"',
				expectedSnapshot: snapshot,
			})
		).rejects.toThrow(/title and description/);
	});

	it('keeps the AI description when the template has no anchor', async () => {
		const client = octokit();
		await updatePrContent(client, 'acme', 'repo', 1, {
			expectedSnapshot: snapshot,
			response:
				'{"title":"New","description":"## Summary\\nReal change\\n\\n## Checklist\\n- [x] Tests"}',
			templateContent:
				'## Summary\n_Describe the change_\n\n## Checklist\n- [ ] Tests',
		});
		expect(client.rest.pulls.update).toHaveBeenCalledWith(
			expect.objectContaining({
				body: '## Summary\nReal change\n\n## Checklist\n- [x] Tests',
			})
		);
	});

	it('fills the template when it carries the description anchor', async () => {
		const client = octokit();
		await updatePrContent(client, 'acme', 'repo', 1, {
			expectedSnapshot: snapshot,
			response: '{"title":"New","description":"Real change"}',
			templateContent:
				'## Summary\n<!-- AI will fill this section with a description of what changed -->\n',
		});
		expect(client.rest.pulls.update).toHaveBeenCalledWith(
			expect.objectContaining({ body: '## Summary\nReal change\n' })
		);
	});

	it('redacts secrets echoed into the title and description', async () => {
		const secret = ['gh', 'p_', 'Zq8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue'].join('');
		const client = octokit();
		await updatePrContent(client, 'acme', 'repo', 1, {
			expectedSnapshot: snapshot,
			response: JSON.stringify({
				title: `Use ${secret}`,
				description: `Token ${secret}`,
			}),
		});
		const args = client.rest.pulls.update.mock.calls[0][0] as {
			title: string;
			body: string;
		};
		expect(`${args.title}${args.body}`).not.toContain(secret);
		expect(args.body).toContain('[REDACTED_GITHUB_TOKEN]');
	});
});

describe('optimistic PR content updates', () => {
	it.each([
		{
			title: 'Maintainer title',
			body: snapshot.body,
			head: { sha: snapshot.headSha },
		},
		{
			title: snapshot.title,
			body: 'Maintainer body',
			head: { sha: snapshot.headSha },
		},
		{ title: snapshot.title, body: snapshot.body, head: { sha: 'head-b' } },
	])('preserves concurrent edits or a changed head: %j', async (live) => {
		const client = octokit();
		client.rest.pulls.get.mockResolvedValue({ data: live });
		await expect(
			updatePrContent(client, 'acme', 'repo', 1, {
				expectedSnapshot: snapshot,
				response: '{"title":"Generated title","description":"Generated body"}',
			})
		).rejects.toThrow(/changed during generation/);
		expect(client.rest.pulls.update).not.toHaveBeenCalled();
	});
	it('accepts an empty description returned as null by GitHub', async () => {
		const client = octokit();
		client.rest.pulls.get.mockResolvedValue({
			data: { title: 'Old', body: null, head: { sha: 'head-a' } },
		});
		await updatePrContent(client, 'acme', 'repo', 1, {
			expectedSnapshot: { ...snapshot, body: '' },
			response: '{"title":"New","description":"Body"}',
		});
		expect(client.rest.pulls.update).toHaveBeenCalledOnce();
	});
	it('preserves literal dollar replacement sequences in both template sections', async () => {
		const client = octokit();
		const text = "Literal $& $` $' $$";
		const description = `${text}\n\n## How Has This Been Tested\n${text}`;
		await updatePrContent(client, 'acme', 'repo', 1, {
			expectedSnapshot: snapshot,
			response: JSON.stringify({ title: 'New', description }),
			templateContent:
				'PREFIX\n<!-- AI will fill this section with a description of what changed -->\nTESTING\n<!-- AI will fill this section with testing information -->\nSUFFIX',
		});
		expect(client.rest.pulls.update).toHaveBeenCalledWith(
			expect.objectContaining({
				body: `PREFIX\n${description}\nTESTING\n${text}\nSUFFIX`,
			})
		);
	});
});
