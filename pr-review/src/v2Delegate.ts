import * as core from '@actions/core';
import * as github from '@actions/github';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * V2 delegation bridge.
 *
 * When the V2 engine bundle exists in the repository checkout, the legacy
 * action entry point delegates the whole review to it. Otherwise V1 runs
 * unchanged. The public interface (inputs, outputs, env vars) is
 * identical either way — see docs/v1-interface-contract.md.
 */

const V2_ENTRY_CANDIDATES = [
	'v2/dist/entry/pr-review.js',
	'../v2/dist/entry/pr-review.js',
];

export function resolveV2Entry(): string | null {
	for (const candidate of V2_ENTRY_CANDIDATES) {
		const full = resolve(process.cwd(), candidate);
		if (existsSync(full)) {
			return full;
		}
	}
	return null;
}

export async function runViaV2IfAvailable(): Promise<boolean> {
	const entry = resolveV2Entry();
	if (!entry) {
		core.info('V2 engine not present; running V1 review flow.');
		return false;
	}

	const context = github.context;
	core.info('Delegating review to the V2 engine.');

	try {
		// Inputs are re-read by the V2 engine from the action context, so
		// nothing needs to be forwarded explicitly here.
		const mod = await import(entry);
		await (mod.main ?? mod.default)(['pr-review']);
		return true;
	} catch (error) {
		core.setFailed(`Action failed: ${error}`);
		return true;
	}
}
