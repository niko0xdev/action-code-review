import { describe, expect, it, vi } from 'vitest';
import { updatePrContent } from '../../src/github/pr-content.js';

function octokit(title = 'Old', body = 'Old body') {
	return {
		rest: {
			pulls: {
				get: vi.fn(async () => ({ data: { title, body } })),
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
		await updatePrContent(client, 'acme', 'repo', 1, { response });
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
			response: '{"title":"New","description":"Body"}',
		});
		expect(client.rest.pulls.update).not.toHaveBeenCalled();
	});

	it('rejects truncated JSON for caller retry', async () => {
		await expect(
			updatePrContent(octokit(), 'a', 'r', 1, { response: '{"title":"x"' })
		).rejects.toThrow(/title and description/);
	});

	it('keeps the AI description when the template has no anchor', async () => {
		const client = octokit();
		await updatePrContent(client, 'acme', 'repo', 1, {
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
