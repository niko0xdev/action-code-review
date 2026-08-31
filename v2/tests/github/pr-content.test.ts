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
});
