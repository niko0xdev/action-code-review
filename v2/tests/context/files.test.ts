import { describe, expect, it } from 'vitest';
import {
	DEFAULT_IGNORE_PATTERNS,
	isLockfile,
	isReviewable,
	prioritizeFiles,
} from '../../src/context/files.js';
import type { ChangedFile } from '../../src/types/context.js';

function file(filename: string, overrides?: Partial<ChangedFile>): ChangedFile {
	return {
		filename,
		status: 'modified',
		additions: 10,
		deletions: 2,
		changes: 12,
		patch: '@@ -1 +1 @@\n-a\n+b',
		...overrides,
	};
}

describe('default ignore rules (spec §32)', () => {
	it.each([
		'node_modules/react/index.js',
		'dist/index.js',
		'build/output.js',
		'coverage/lcov-report/index.html',
		'.next/server/app.js',
		'vendor/lib.js',
		'generated/proto.ts',
		'app.min.js',
		'source.map',
		'__snapshots__/app.snap',
	])('ignores %s', (path) => {
		expect(isReviewable(file(path))).toBe(false);
	});

	it.each(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'uv.lock'])(
		'ignores lockfile %s',
		(path) => {
			expect(isReviewable(file(path))).toBe(false);
			expect(isLockfile(path)).toBe(true);
		}
	);

	it('still reviews dependency manifests', () => {
		for (const path of [
			'package.json',
			'pyproject.toml',
			'Podfile',
			'Package.swift',
			'build.gradle.kts',
		]) {
			expect(isReviewable(file(path))).toBe(true);
		}
	});

	it('reviews ordinary source files', () => {
		expect(isReviewable(file('src/users/user.service.ts'))).toBe(true);
		expect(isReviewable(file('app/page.tsx'))).toBe(true);
	});
});

describe('prioritizeFiles (spec §31)', () => {
	it('drops unreviewable files and truncates to the cap by change volume', () => {
		const files = [
			file('src/small.ts', { changes: 5 }),
			file('src/huge.tsx', { changes: 500 }),
			file('dist/bundle.js'),
			file('src/medium.ts', { changes: 100 }),
		];
		const prioritized = prioritizeFiles(files, 3);
		expect(prioritized.map((f) => f.filename)).toEqual([
			'src/huge.tsx',
			'src/medium.ts',
			'src/small.ts',
		]);
	});
});

describe('DEFAULT_IGNORE_PATTERNS coverage', () => {
	it.each([
		['src/normal.ts', true],
		['docs/readme.md', true],
	])('keeps reviewable files reviewable: %s', (path, expectedReviewable) => {
		expect(isReviewable(file(path))).toBe(expectedReviewable);
	});

	it('is exported as a non-empty rule set', () => {
		expect(DEFAULT_IGNORE_PATTERNS.length).toBeGreaterThan(8);
	});
});
