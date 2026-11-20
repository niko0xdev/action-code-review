import { expect, it, vi } from 'vitest';

const getInput = vi.hoisted(() => vi.fn(() => ''));
const getOctokit = vi.hoisted(() => vi.fn());
vi.mock('@actions/core', () => ({ getInput, warning: vi.fn() }));
vi.mock('@actions/github', () => ({
	getOctokit,
	context: {
		payload: {
			action: 'created',
			comment: { id: 8 },
			pull_request: { number: 2 },
			sender: { login: 'automation[bot]', type: 'Bot' },
		},
	},
}));

import { runFollowup } from '../src/runners/followup.js';

it('does not initialise a client when disabled', async () => {
	await runFollowup();
	expect(getOctokit).not.toHaveBeenCalled();
});

it('rejects bot senders before initialising a client', async () => {
	getInput.mockReturnValueOnce('@reviewer');
	await runFollowup();
	expect(getOctokit).not.toHaveBeenCalled();
});

it('stops before reading review comments when permission cannot be verified', async () => {
	const { context } = await import('@actions/github');
	const sender = context.payload.sender;
	context.payload.sender = {
		login: 'maintainer',
		type: 'User',
	} as typeof sender;
	const permission = vi.fn().mockRejectedValue(new Error('Unavailable'));
	const getReviewComment = vi.fn();
	getInput.mockReturnValueOnce('@reviewer').mockReturnValueOnce('token');
	getOctokit.mockReturnValueOnce({
		rest: {
			repos: { getCollaboratorPermissionLevel: permission },
			pulls: { getReviewComment },
		},
	});
	Object.assign(context, { repo: { owner: 'acme', repo: 'widget' } });
	try {
		await runFollowup();
		expect(permission).toHaveBeenCalledOnce();
		expect(getReviewComment).not.toHaveBeenCalled();
	} finally {
		context.payload.sender = sender;
	}
});
