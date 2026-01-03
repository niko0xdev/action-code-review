import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from '../index';

// Mock dependencies
vi.mock('@actions/core');
vi.mock('@actions/github');
vi.mock('openai');

describe('index', () => {
	let mockOctokit: any;
	let mockOpenai: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockOctokit = {
			rest: {
				issues: {
					getComment: vi.fn(),
				},
				pulls: {
					get: vi.fn(),
					listReviews: vi.fn(),
					listCommentsForReview: vi.fn(),
				},
				repos: {
					getContent: vi.fn(),
				},
			},
		};

		mockOpenai = {
			chat: {
				completions: {
					create: vi.fn(),
				},
			},
		};

		vi.mocked(github.getOctokit).mockReturnValue(mockOctokit);
		vi.mocked(core.getInput).mockImplementation((name) => {
			const inputs: Record<string, string> = {
				'github-token': 'ghp_test',
				'openai-api-key': 'sk_test',
				'openai-model': 'gpt-4',
				'enable-question-detection': 'true',
				'include-full-content': 'false',
				'max-context-chars': '10000',
			};
			return inputs[name] || '';
		});

		vi.mocked(core.getBooleanInput).mockImplementation((name) => {
			const boolInputs: Record<string, boolean> = {
				'enable-question-detection': true,
				'include-full-content': false,
			};
			return boolInputs[name] || false;
		});

		vi.mocked(github.context).payload = {
			comment: {
				id: 456,
				body: 'What is this?',
				user: { login: 'developer', type: 'User' },
				created_at: '2024-01-01T00:00:00Z',
			},
			issue: {
				number: 1,
				title: 'Fix bug',
				pull_request: true,
			},
		};

		vi.mocked(github.context).repo = { owner: 'owner', repo: 'repo' };
	});

	it('should process a valid PR comment and generate reply', async () => {
		vi.mocked(mockOctokit.rest.pulls.get).mockResolvedValue({
			data: {
				head: { sha: 'abc123' },
			},
		});

		vi.mocked(mockOctokit.rest.issues.getComment)
			.mockResolvedValueOnce({
				data: {
					id: 456,
					body: 'What is this?',
					in_reply_to_id: 123,
					user: { login: 'developer' },
				},
			})
			.mockResolvedValueOnce({
				data: {
					id: 123,
					body: 'Fix this\n\n<!-- ai-review-id:abc123def456 -->',
					user: { login: 'ai-bot' },
				},
			});

		vi.mocked(mockOctokit.rest.issues.createCommentReply).mockResolvedValue({
			data: {},
		});

		vi.mocked(mockOpenai.chat.completions.create).mockResolvedValue({
			choices: [
				{
					message: {
						content: 'This is the answer.',
					},
				},
			],
		});

		// Mock the OpenAI constructor
		const OpenAI = require('openai').default;
		vi.spyOn(OpenAI.prototype, 'chat', 'get').mockReturnValue(mockOpenai.chat);

		await run();

		expect(core.setOutput).toHaveBeenCalledWith('reply-generated', 'true');
		expect(mockOctokit.rest.issues.createCommentReply).toHaveBeenCalled();
	});

	it('should skip comments not on PRs', async () => {
		vi.mocked(github.context).payload.issue = {
			number: 1,
			title: 'Fix bug',
			pull_request: false,
		};

		await run();

		expect(core.setFailed).not.toHaveBeenCalled();
		expect(mockOctokit.rest.issues.createCommentReply).not.toHaveBeenCalled();
	});

	it('should skip bot comments', async () => {
		vi.mocked(github.context).payload.comment!.user!.type = 'Bot';

		await run();

		expect(mockOctokit.rest.issues.createCommentReply).not.toHaveBeenCalled();
	});

	it('should skip AI reply comments', async () => {
		vi.mocked(github.context).payload.comment!.body =
			'This is an AI reply\n\n<!-- ai-reply -->';

		await run();

		expect(mockOctokit.rest.issues.createCommentReply).not.toHaveBeenCalled();
	});

	it('should skip non-question comments when detection enabled', async () => {
		vi.mocked(github.context).payload.comment!.body = 'This looks good';

		await run();

		expect(mockOctokit.rest.issues.createCommentReply).not.toHaveBeenCalled();
	});

	it('should handle errors gracefully', async () => {
		vi.mocked(mockOctokit.rest.pulls.get).mockRejectedValue(
			new Error('API error')
		);

		await run();

		expect(core.setFailed).toHaveBeenCalled();
	});
});

