import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import * as core from '@actions/core';

const CANDIDATES = [
	'v2/dist/entry/pr-content.js',
	'../v2/dist/entry/pr-content.js',
	'../../v2/dist/entry/pr-content.js',
];

async function run(): Promise<void> {
	const base = process.env.GITHUB_ACTION_PATH;
	const root =
		base && isAbsolute(base) ? base : process.cwd();
	for (const candidate of CANDIDATES) {
		const entry = resolve(root, candidate);
		if (!existsSync(entry)) continue;
		core.info('Delegating PR content to the V2 engine.');
		const mod = await import(entry);
		await (mod.main ?? mod.default)(['pr-content']);
		return;
	}
	core.setFailed(
		'V2 engine bundle missing (searched v2/dist/entry/pr-content.js from GITHUB_ACTION_PATH or cwd). Reinstall the action checkout.'
	);
}

run().catch((error) => {
	core.setFailed(
		`Action failed: ${error instanceof Error ? error.message : String(error)}`
	);
});
