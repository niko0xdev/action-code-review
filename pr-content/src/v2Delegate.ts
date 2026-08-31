import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as core from '@actions/core';

const V2_ENTRY_CANDIDATES = [
	'v2/dist/entry/pr-content.js',
	'../v2/dist/entry/pr-content.js',
];

export function resolveV2Entry(baseDir?: string): string | null {
	for (const candidate of V2_ENTRY_CANDIDATES) {
		const full = resolve(baseDir ?? process.cwd(), candidate);
		if (existsSync(full)) return full;
	}
	return null;
}

export async function runViaV2IfAvailable(): Promise<boolean> {
	const entry = resolveV2Entry();
	if (!entry) {
		core.info('V2 engine not present; running V1 content flow.');
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
