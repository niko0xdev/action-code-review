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
	aiResponse: string,
	templateContent?: string
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

		// If we have a template, use the AI-generated description to fill it in
		let finalDescription = update.description;
		if (templateContent) {
			// Try to extract the description from the AI response if it's in a template format
			// Otherwise, use the description as is
			if (update.description.includes('## Description')) {
				finalDescription = update.description;
			} else {
				// Fill the template with the AI-generated description
				finalDescription = templateContent.replace(
					/<!-- AI will fill this section with a description of what changed -->/,
					update.description
				);
				
				// Also fill in the testing section if the AI provided it
				if (update.description.includes('## How Has This Been Tested')) {
					const testingMatch = update.description.match(/## How Has This Been Tested\s*\n([\s\S]*?)(?=\n##|\n\n|$)/);
					if (testingMatch) {
						finalDescription = finalDescription.replace(
							/<!-- AI will fill this section with testing information -->/,
							testingMatch[1].trim()
						);
					}
				}
			}
		}

		const hasChanges =
			currentPR.data.title !== update.title ||
			currentPR.data.body !== finalDescription;

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
			body: finalDescription,
		});

		core.info(`Updated PR title: "${update.title}"`);
		core.info(
			`Updated PR description: ${finalDescription.substring(0, 100)}...`
		);
	} catch (error) {
		core.error(`Failed to update PR content: ${error}`);
		throw error;
	}
}
