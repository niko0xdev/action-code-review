import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveV2Entry } from '../v2Delegate.js';

describe('resolveV2Entry (pr-content)', () => {
	let tmpDir: string;
	const ORIGINAL_ENV = process.env.GITHUB_ACTION_PATH;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'v2delegate-content-test-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		if (ORIGINAL_ENV === undefined) {
			process.env.GITHUB_ACTION_PATH = undefined;
		} else {
			process.env.GITHUB_ACTION_PATH = ORIGINAL_ENV;
		}
	});

	function writeEntry(relPath: string): void {
		const full = join(tmpDir, relPath);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, 'export const main = () => {};');
	}

	it('finds pr-content entry via GITHUB_ACTION_PATH', () => {
		writeEntry('v2/dist/entry/pr-content.js');
		process.env.GITHUB_ACTION_PATH = tmpDir;
		expect(resolveV2Entry()).toBe(join(tmpDir, 'v2/dist/entry/pr-content.js'));
	});

	it('returns null when pr-content entry not present', () => {
		process.env.GITHUB_ACTION_PATH = join(tmpDir, 'no-v2-here');
		expect(resolveV2Entry()).toBeNull();
	});

	it('explicit baseDir wins over GITHUB_ACTION_PATH', () => {
		writeEntry('v2/dist/entry/pr-content.js');
		process.env.GITHUB_ACTION_PATH = '/nonexistent/path';
		expect(resolveV2Entry(tmpDir)).toBe(join(tmpDir, 'v2/dist/entry/pr-content.js'));
	});
});
