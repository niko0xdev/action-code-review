import * as core from '@actions/core';

import type { PublisherOctokit } from './review.js';

export function isBotActor(actor: string): boolean {
	return actor.endsWith('[bot]');
}

/** Null means the caller could not verify the permission. */
export async function strictHumanWritePermission(
	octokit: PublisherOctokit,
	owner: string,
	repo: string,
	user: { login: string; __typename: string }
): Promise<boolean | null> {
	if (
		user.__typename !== 'User' ||
		!user.login ||
		isBotActor(user.login.toLowerCase())
	)
		return false;
	try {
		const result = await octokit.rest.repos?.getCollaboratorPermissionLevel({
			owner,
			repo,
			username: user.login.toLowerCase(),
		});
		switch (result?.data.permission) {
			case 'admin':
			case 'maintain':
			case 'write':
				return true;
			case 'triage':
			case 'read':
			case 'none':
				return false;
			default:
				return null;
		}
	} catch {
		return null;
	}
}

export async function hasWritePermission(
	octokit: PublisherOctokit,
	owner: string,
	repo: string,
	actor: string
): Promise<boolean> {
	if (!actor) return true;
	if (isBotActor(actor)) return true;
	const repos = (
		octokit as unknown as {
			rest?: {
				repos?: {
					getCollaboratorPermissionLevel?: (args: {
						owner: string;
						repo: string;
						username: string;
					}) => Promise<{ data: { permission: string } }>;
				};
			};
		}
	).rest?.repos;
	const method = repos?.getCollaboratorPermissionLevel;
	if (!method) {
		core.warning(
			'[review] getCollaboratorPermissionLevel not available — assuming write permission'
		);
		return true;
	}
	try {
		const { data } = await method({ owner, repo, username: actor });
		const perm = data.permission;
		core.info(`[review] Permission for ${actor}: ${perm}`);
		return perm === 'admin' || perm === 'write';
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		core.warning(`[review] Permission check failed for ${actor}: ${msg}`);
		return false;
	}
}
