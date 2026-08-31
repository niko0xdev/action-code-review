import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';

/**
 * V2 delegation bridge.
 *
 * When the V2 engine bundle exists alongside this action's installed
 * entry point, the legacy action delegates the whole review to it.
 * Otherwise V1 runs unchanged. The public interface (inputs, outputs,
 * env vars) is identical either way — see docs/v1-interface-contract.md.
 *
 * The V2 dist lives at `<action-repo>/v2/dist/entry/pr-{review,content}.js`,
 * i.e. next to this compiled `dist/index.js`. We resolve candidates
 * relative to GitHub Actions' `GITHUB_ACTION_PATH` env var first (the
 * absolute path to the action checkout), then fall back to `process.cwd()`
 * (the consumer's repo, where this bridge CANNOT find V2 — it returns null
 * and V1 runs). This avoids the false-negative case where `process.cwd()`
 * is the consumer repo and the candidate paths look valid but don't
 * actually resolve to anything.
 */

const V2_ENTRY_CANDIDATES = [
	// Standard layout when this action is checked out into its own repo:
	'v2/dist/entry/pr-review.js',
	// When this file lives inside a sub-package dist (e.g. <repo>/pr-review/dist):
	// relative `../v2/...` walks from `dist/` up to `pr-review/`. If v2/ is at
	// `<repo>/v2/`, the caller must pass the repo root as the baseDir (the
	// composite action does this via GITHUB_ACTION_PATH at runtime).
	'../v2/dist/entry/pr-review.js',
	// Two levels up: if this file is shipped as e.g. <repo>/pr-review/dist/index.js
	// and v2/ sits at <repo>/v2/, this candidate from <repo>/pr-review/dist is
	// `../../v2/dist/entry/pr-review.js`.
	'../../v2/dist/entry/pr-review.js',
];

function resolveBaseDir(): string {
	// GitHub Actions sets GITHUB_ACTION_PATH to the absolute path of the
	// action checkout (where this compiled file lives). When set, prefer it
	// over process.cwd() so the V2 candidates resolve to the action's own
	// dist tree, not the consumer's repo root.
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
		if (existsSync(full)) {
			return full;
		}
	}
	return null;
}

export async function runViaV2IfAvailable(): Promise<boolean> {
	const entry = resolveV2Entry();
	if (!entry) {
		core.info(
			`V2 engine not present; running V1 review flow. (searched ${
				process.env.GITHUB_ACTION_PATH
					? `GITHUB_ACTION_PATH=${process.env.GITHUB_ACTION_PATH}`
					: `cwd=${process.cwd()}`
			})`
		);
		return false;
	}

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
