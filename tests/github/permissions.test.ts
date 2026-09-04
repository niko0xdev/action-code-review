import { describe, expect, it, vi } from 'vitest';
import {
	hasWritePermission,
	isBotActor,
} from '../../src/github/permissions.js';

describe('isBotActor', () => {
	it('detects [bot] suffix', () => {
		expect(isBotActor('claude[bot]')).toBe(true);
		expect(isBotActor('renovate[bot]')).toBe(true);
		expect(isBotActor('alice')).toBe(false);
	});
});

describe('hasWritePermission', () => {
	function octokitWith(
		perms: Record<string, string> = {},
		noReposMethod = false
	) {
		if (noReposMethod) return { rest: {} } as never;
		return {
			rest: {
				repos: {
					getCollaboratorPermissionLevel: vi.fn(
						async ({ username }: { username: string }) => {
							const perm = perms[username] ?? 'read';
							return { data: { permission: perm } };
						}
					),
				},
			},
		} as never;
	}

	it('returns true for missing actor or bot actor', async () => {
		expect(await hasWritePermission(octokitWith(), 'o', 'r', '')).toBe(true);
		expect(
			await hasWritePermission(octokitWith(), 'o', 'r', 'claude[bot]')
		).toBe(true);
	});

	it('grants admin/write, denies read/none', async () => {
		expect(
			await hasWritePermission(
				octokitWith({ alice: 'admin' }),
				'o',
				'r',
				'alice'
			)
		).toBe(true);
		expect(
			await hasWritePermission(octokitWith({ bob: 'write' }), 'o', 'r', 'bob')
		).toBe(true);
		expect(
			await hasWritePermission(
				octokitWith({ carol: 'read' }),
				'o',
				'r',
				'carol'
			)
		).toBe(false);
		expect(
			await hasWritePermission(octokitWith({ dave: 'none' }), 'o', 'r', 'dave')
		).toBe(false);
	});

	it('returns true when repos method unavailable', async () => {
		expect(
			await hasWritePermission(octokitWith({}, true), 'o', 'r', 'alice')
		).toBe(true);
	});

	it('returns false when collaborator check throws', async () => {
		const octokit = {
			rest: {
				repos: {
					getCollaboratorPermissionLevel: vi.fn(async () => {
						throw new Error('Not Found');
					}),
				},
			},
		} as never;
		expect(await hasWritePermission(octokit, 'o', 'r', 'alice')).toBe(false);
	});
});
