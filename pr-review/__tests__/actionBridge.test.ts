import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveV2Entry } from '../src/v2Delegate';
import samplePr from './fixtures/sample-pr.json';

/**
 * Self-review bridge tests: prove the delegation logic picks V2 when the
 * engine bundle is present in the checkout and falls back to V1
 * otherwise. No real API calls — the fixture payload only exercises the
 * JSON shape the action consumes.
 */

describe('V2 delegation bridge', () => {
	it('resolves the entry when v2/dist/entry/pr-review.js exists', () => {
		// The repository checkout builds the engine bundle at that path.
		const repoRoot = resolve(__dirname, '../..');
		const expected = resolve(repoRoot, 'v2/dist/entry/pr-review.js');
		if (existsSync(expected)) {
			expect(resolveV2Entry(repoRoot)).toBe(expected);
		} else {
			expect(resolveV2Entry(repoRoot)).toBeNull();
		}
	});

	it('returns null when no candidate exists (V1 fallback)', () => {
		const scratch = mkdtempSync(join(tmpdir(), 'bridge-missing-'));
		try {
			expect(resolveV2Entry(scratch)).toBeNull();
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});

	it('detects a synthesized entry inside a scratch checkout', () => {
		const scratch = mkdtempSync(join(tmpdir(), 'bridge-present-'));
		const entryDir = join(scratch, 'v2', 'dist', 'entry');
		mkdirSync(entryDir, { recursive: true });
		writeFileSync(join(entryDir, 'pr-review.js'), 'export default () => {};');
		try {
			expect(resolveV2Entry(scratch)).toBe(
				resolve(join(entryDir, 'pr-review.js'))
			);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});
});

describe('sample PR fixture', () => {
	it('is a well-formed pull_request payload with changed files', () => {
		expect(samplePr.number).toBe(42);
		expect(samplePr.pull_request.head.sha).toMatch(/^[0-9a-f]{40}$/);
		expect(Array.isArray(samplePr.changed_files)).toBe(true);

		const [first] = samplePr.changed_files;
		expect(first.filename).toMatch(/\.(ts|tsx|js|jsx|py|swift|kt)$/);
		expect(first.patch).toContain('@@');
		expect(samplePr.pull_request.title.length).toBeGreaterThan(0);
	});

	it('carries a diff hunk the parser can anchor findings against', () => {
		const patch = samplePr.changed_files[0].patch as string;
		const hunkHeader = patch.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m);
		expect(hunkHeader).not.toBeNull();
	});
});
