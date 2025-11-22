import * as github from '@actions/github';
import * as core from '@actions/core';

type OctokitType = ReturnType<typeof github.getOctokit>;

interface PRContentUpdate {
	title: string;
	description: string;
}

export async function updatePullRequestContent(
	octokit: OctokitType,
	owner: string,
	repo: string,
	pullNumber: number,
	aiResponse: string
): Promise<void> {
	try {
		// Parse AI response
		let update: PRContentUpdate;
		try {
			update = JSON.parse(aiResponse);
		} catch (parseError) {
			// Try to extract JSON from response if it contains extra text
			const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				update = JSON.parse(jsonMatch[0]);
			} else {
				throw new Error('Failed to parse AI response as JSON');
			}
		}

		// Validate response
		if (!update.title || !update.description) {
			throw new Error(
				'AI response missing required fields: title and description'
			);
		}

		// Get current PR to compare
		const currentPR = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: pullNumber,
		});

		const hasChanges =
			currentPR.data.title !== update.title ||
			currentPR.data.body !== update.description;

		if (!hasChanges) {
			core.info('No changes needed - PR content is already optimal');
			return;
		}

		// Update PR
		await octokit.rest.pulls.update({
			owner,
			repo,
			pull_number: pullNumber,
			title: update.title,
			body: update.description,
		});

		core.info(`Updated PR title: "${update.title}"`);
		core.info(
			`Updated PR description: ${update.description.substring(0, 100)}...`
		);
	} catch (error) {
		core.error(`Failed to update PR content: ${error}`);
		throw error;
	}
}
