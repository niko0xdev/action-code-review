import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import * as core from '@actions/core';

/**
 * V2 delegation bridge for pr-content.
 *
 * Mirrors `pr-review/src/v2Delegate.ts`. Resolves the V2 entry bundle
 * relative to `GITHUB_ACTION_PATH` (the action checkout) so the V2
 * engine is found at runtime regardless of the consumer repo's CWD.
 *
 * The V2 dist lives at `<action-repo>/v2/dist/entry/pr-content.js`,
 * i.e. next to this compiled `dist/index.js`.
 */

const V2_ENTRY_CANDIDATES = [
	'v2/dist/entry/pr-content.js',
	'../v2/dist/entry/pr-content.js',
	'../../v2/dist/entry/pr-content.js',
];

function resolveBaseDir(): string {
	const fromEnv = process.env.GITHUB_ACTION_PATH;
	if (fromEnv && isAbsolute(fromEnv)) {
		return fromEnv;
	}
	return process.cwd();
}

export function resolveV2Entry(baseDir?: string): string | null {
	const root = baseDir ?? resolveBaseDir();
	for (const candidate of V2_ENTRY_CANDIDATES) {
		const full = resolve(root, candidate);
		if (existsSync(full)) return full;
	}
	return null;
}

export async function runViaV2IfAvailable(): Promise<boolean> {
	const entry = resolveV2Entry();
	if (!entry) {
		core.info(
			`V2 engine not present; running V1 content flow. (searched ${
				process.env.GITHUB_ACTION_PATH
					? `GITHUB_ACTION_PATH=${process.env.GITHUB_ACTION_PATH}`
					: `cwd=${process.cwd()}`
			})`
		);
		return false;
	}
	core.info('Delegating PR content to the V2 engine.');
	try {
		const mod = await import(entry);
		await (mod.main ?? mod.default)(['pr-content']);
		return true;
	} catch (error) {
		core.setFailed(`Action failed: ${error}`);
		return true;
	}
}
