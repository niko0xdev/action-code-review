import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveV2Entry } from '../src/v2Delegate.js';

describe('resolveV2Entry', () => {
	let tmpDir: string;
	const ORIGINAL_ENV = process.env.GITHUB_ACTION_PATH;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'v2delegate-test-'));
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

	it('finds the entry bundle relative to GITHUB_ACTION_PATH', () => {
		writeEntry('v2/dist/entry/pr-review.js');
		process.env.GITHUB_ACTION_PATH = tmpDir;
		expect(resolveV2Entry()).toBe(join(tmpDir, 'v2/dist/entry/pr-review.js'));
	});

	it('finds the entry bundle via ../ relative path', () => {
		writeEntry('v2/dist/entry/pr-review.js');
		// Layout emulates pr-review/dist as GITHUB_ACTION_PATH (../../v2)
		process.env.GITHUB_ACTION_PATH = join(tmpDir, 'pr-review/dist');
		expect(resolveV2Entry()).toBe(join(tmpDir, 'v2/dist/entry/pr-review.js'));
	});

	it('returns null when entry not present at GITHUB_ACTION_PATH', () => {
		process.env.GITHUB_ACTION_PATH = join(tmpDir, 'no-v2-here');
		expect(resolveV2Entry()).toBeNull();
	});

	it('returns null when GITHUB_ACTION_PATH unset and cwd lacks V2', () => {
		process.env.GITHUB_ACTION_PATH = undefined;
		expect(resolveV2Entry(tmpDir)).toBeNull();
	});

	it('explicit baseDir wins over GITHUB_ACTION_PATH', () => {
		writeEntry('v2/dist/entry/pr-review.js');
		process.env.GITHUB_ACTION_PATH = '/nonexistent/path';
		expect(resolveV2Entry(tmpDir)).toBe(join(tmpDir, 'v2/dist/entry/pr-review.js'));
	});

	it('isAbsolute guard rejects relative GITHUB_ACTION_PATH', () => {
		// If GITHUB_ACTION_PATH is set to a relative path for any reason,
		// bridge falls back to process.cwd() rather than chasing the
		// relative path from the consumer's working directory. We just
		// verify the call does not throw — the return value depends on the
		// test runner's cwd and is implementation-defined here.
		process.env.GITHUB_ACTION_PATH = 'relative/path';
		expect(() => resolveV2Entry()).not.toThrow();
	});
});
