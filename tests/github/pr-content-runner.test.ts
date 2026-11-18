import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPrContentAction } from '../../src/runners/pr-content.js';

const state = vi.hoisted(() => ({
	live: {
		title: 'Original title',
		body: 'Original body',
		head: { sha: 'head-a', ref: 'feature' },
		base: { sha: 'base', ref: 'main' },
		number: 1,
	},
	complete: vi.fn(),
	update: vi.fn(),
	output: vi.fn(),
}));
vi.mock('@actions/github', () => ({
	context: {
		payload: { pull_request: { number: 1 } },
		repo: { owner: 'acme', repo: 'widget' },
	},
	getOctokit: () => ({
		rest: {
			pulls: {
				get: async () => ({ data: state.live }),
				listFiles: async () => ({ data: [] }),
				update: state.update,
			},
			repos: {
				getContent: async () => {
					throw new Error('No template');
				},
			},
			issues: {},
			users: {},
		},
	}),
}));
vi.mock('@actions/core', () => ({
	getInput: (name: string) =>
		({
			'github-token': 'synthetic',
			'openai-api-key': 'synthetic',
			'openai-model': 'mock',
		})[name] ?? '',
	info: vi.fn(),
	warning: vi.fn(),
	setFailed: vi.fn(),
	setOutput: state.output,
	summary: { addRaw: () => ({ write: async () => {} }) },
}));
vi.mock('../../src/llm/openai-compatible.js', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('../../src/llm/openai-compatible.js')
	>()),
	OpenAiCompatibleProvider: vi.fn(() => ({ complete: state.complete })),
}));
beforeEach(() => {
	state.live = {
		title: 'Original title',
		body: 'Original body',
		head: { sha: 'head-a', ref: 'feature' },
		base: { sha: 'base', ref: 'main' },
		number: 1,
	};
	state.complete.mockReset().mockResolvedValue({
		content: '{"title":"Generated title","description":"Generated body"}',
	});
	state.update.mockReset().mockResolvedValue({ data: {} });
	state.output.mockReset();
});
describe('PR content runner snapshot', () => {
	it.each(['title', 'body', 'head'] as const)(
		'does not overwrite %s changed during generation or retry the conflict',
		async (field) => {
			state.complete.mockImplementation(async () => {
				if (field === 'head')
					state.live.head = { sha: 'head-b', ref: 'feature' };
				else state.live[field] = 'Maintainer edit';
				return {
					content: '{"title":"Generated title","description":"Generated body"}',
				};
			});
			await expect(runPrContentAction()).rejects.toThrow(
				/changed during generation/
			);
			expect(state.update).not.toHaveBeenCalled();
			expect(state.complete).toHaveBeenCalledOnce();
			expect(state.output).not.toHaveBeenCalled();
		}
	);
	it('retains the original snapshot when retrying malformed generation', async () => {
		state.complete
			.mockResolvedValueOnce({ content: 'not JSON' })
			.mockImplementationOnce(async () => {
				state.live.body = 'Maintainer edit during retry';
				return {
					content: '{"title":"Generated title","description":"Generated body"}',
				};
			});
		await expect(runPrContentAction()).rejects.toThrow(
			/changed during generation/
		);
		expect(state.complete).toHaveBeenCalledTimes(2);
		expect(state.update).not.toHaveBeenCalled();
	});
	it('updates an unchanged snapshot through the real Octokit adapter', async () => {
		await runPrContentAction();
		expect(state.update).toHaveBeenCalledWith({
			owner: 'acme',
			repo: 'widget',
			pull_number: 1,
			title: 'Generated title',
			body: 'Generated body',
		});
		expect(state.output).toHaveBeenCalledWith(
			'pr-content-summary',
			expect.stringContaining('**Status:** updated')
		);
	});
});
