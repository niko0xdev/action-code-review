import * as core from '@actions/core';
import * as github from '@actions/github';
import { OpenAI } from 'openai';
import { createSystemPrompt, buildUserPrompt } from './prompts';
import { updatePullRequestContent } from './contentUpdater';

async function run(): Promise<void> {
	try {
		const githubToken = core.getInput('github-token', { required: true });
		const openaiApiKey = core.getInput('openai-api-key', { required: true });
		const model = core.getInput('model') || 'gpt-4';
		const maxTokens = Number.parseInt(core.getInput('max-tokens') || '1000');
		const includeFileList = core.getInput('include-file-list') === 'true';
		const customInstructions = core.getInput('custom-instructions');
		const templatePath = core.getInput('template-path') || '.github/pull_request_template.md';

		const octokit = github.getOctokit(githubToken);
		const openai = new OpenAI({ apiKey: openaiApiKey });

		const context = github.context;
		if (!context.payload.pull_request) {
			core.setFailed('This action can only be run on pull requests');
			return;
		}

		const { owner, repo } = context.repo;
		const pullNumber = context.payload.pull_request.number;

		// Get PR details, diff, and template
		const [pr, files, templateResponse] = await Promise.all([
			octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
			octokit.rest.pulls.listFiles({ owner, repo, pull_number: pullNumber }),
			// Try to get the template file
			octokit.rest.repos.getContent({ owner, repo, path: templatePath }).catch(() => null)
		]);

		// Extract template content if available
		let templateContent = '';
		if (templateResponse && 'content' in templateResponse.data) {
			templateContent = Buffer.from(templateResponse.data.content, 'base64').toString('utf8');
		}

		// Get diff for each file
		const diffs = await Promise.all(
			files.data.map(async (file) => {
				if (file.patch) {
					return {
						filename: file.filename,
						status: file.status,
						patch: file.patch,
					};
				}
				return null;
			})
		);

		const validDiffs = diffs.filter(
			(d): d is NonNullable<typeof d> => d !== null
		);

		// Build prompts
		const systemPrompt = createSystemPrompt(customInstructions, templateContent);
		const userPrompt = buildUserPrompt(
			pr.data.title,
			pr.data.body || '',
			validDiffs,
			includeFileList
		);

		// Generate content with AI
		const completion = await openai.chat.completions.create({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			max_tokens: maxTokens,
			temperature: 0.3,
		});

		const response = completion.choices[0]?.message?.content;
		if (!response) {
			core.setFailed('No response from OpenAI');
			return;
		}

		// Parse and update PR
		await updatePullRequestContent(octokit, owner, repo, pullNumber, response, templateContent);

		core.info('Successfully updated pull request content');
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
		} else {
			core.setFailed('An unknown error occurred');
		}
	}
}

run();
