import { describe, expect, it } from 'vitest';
import { buildFileCoverage } from '../../src/review/coverage.js';
import { redactSecrets } from '../../src/security/redaction/redactor.js';
import type { ChangedFile } from '../../src/types/context.js';

function file(filename: string, patch = 'diff'): ChangedFile {
	return {
		filename,
		status: 'modified',
		additions: 1,
		deletions: 0,
		changes: 1,
		...(patch ? { patch } : {}),
	};
}

describe('buildFileCoverage', () => {
	it('accounts for reviewed files and every exclusion reason in pipeline order', () => {
		const files = [
			file('src/reviewed.ts'),
			file('docs/private.md'),
			file('src/no-patch.ts', ''),
			file('dist/generated.js'),
			file('src/capped.ts'),
		];
		const coverage = buildFileCoverage({
			files,
			filteredPaths: [
				'src/reviewed.ts',
				'src/no-patch.ts',
				'dist/generated.js',
				'src/capped.ts',
			],
			selectedPaths: ['src/reviewed.ts'],
			reviewedPaths: ['src/reviewed.ts'],
			failedGroups: 0,
		});

		expect(coverage).toEqual({
			filesOmitted: 0,
			fileDetailsTruncated: false,
			files: [
				{ path: 'src/reviewed.ts', status: 'reviewed' },
				{
					path: 'docs/private.md',
					status: 'excluded',
					reason: 'configured-filter',
				},
				{
					path: 'src/no-patch.ts',
					status: 'excluded',
					reason: 'missing-patch',
				},
				{
					path: 'dist/generated.js',
					status: 'excluded',
					reason: 'default-ignore',
				},
				{ path: 'src/capped.ts', status: 'excluded', reason: 'max-files' },
			],
		});
	});

	it('distinguishes selected files that were not analyzed after a group failure', () => {
		expect(
			buildFileCoverage({
				files: [file('src/a.ts'), file('src/b.ts')],
				filteredPaths: ['src/a.ts', 'src/b.ts'],
				selectedPaths: ['src/a.ts', 'src/b.ts'],
				reviewedPaths: ['src/a.ts'],
				failedGroups: 1,
			})
		).toEqual({
			filesOmitted: 0,
			fileDetailsTruncated: false,
			files: [
				{ path: 'src/a.ts', status: 'reviewed' },
				{
					path: 'src/b.ts',
					status: 'not-analyzed',
					reason: 'review-group-failed',
				},
			],
		});
	});

	it('uses a general incomplete reason when a selected file is missing without failed-group diagnostics', () => {
		expect(
			buildFileCoverage({
				files: [file('src/a.ts')],
				filteredPaths: ['src/a.ts'],
				selectedPaths: ['src/a.ts'],
				reviewedPaths: [],
				failedGroups: 0,
			})
		).toEqual({
			filesOmitted: 0,
			fileDetailsTruncated: false,
			files: [
				{
					path: 'src/a.ts',
					status: 'not-analyzed',
					reason: 'review-incomplete',
				},
			],
		});
	});

	it('bounds serialized file details and reports how many entries were omitted', () => {
		const coverage = buildFileCoverage(
			{
				files: [file('src/a.ts'), file('src/b.ts')],
				filteredPaths: [],
				selectedPaths: [],
				reviewedPaths: [],
				failedGroups: 0,
			},
			80
		);

		expect(coverage).toEqual({
			files: [
				{ path: 'src/a.ts', status: 'excluded', reason: 'configured-filter' },
			],
			filesOmitted: 1,
			fileDetailsTruncated: true,
		});
		expect(JSON.stringify(coverage.files).length).toBeLessThanOrEqual(80);
	});

	it('handles an empty PR file list without reporting false truncation', () => {
		expect(
			buildFileCoverage({
				files: [],
				filteredPaths: [],
				selectedPaths: [],
				reviewedPaths: [],
				failedGroups: 0,
			})
		).toEqual({ files: [], filesOmitted: 0, fileDetailsTruncated: false });
	});

	it('omits a first entry that alone exceeds the configured size ceiling', () => {
		const coverage = buildFileCoverage(
			{
				files: [file(`src/${'a'.repeat(100)}.ts`)],
				filteredPaths: [],
				selectedPaths: [],
				reviewedPaths: [],
				failedGroups: 0,
			},
			80
		);

		expect(coverage).toEqual({
			files: [],
			filesOmitted: 1,
			fileDetailsTruncated: true,
		});
	});

	it('caps the redacted output size when redaction expands a file path', () => {
		const coverage = buildFileCoverage(
			{
				files: [file('Bearer abcdefgh')],
				filteredPaths: [],
				selectedPaths: [],
				reviewedPaths: [],
				failedGroups: 0,
			},
			80
		);

		expect(
			redactSecrets(JSON.stringify(coverage.files)).length
		).toBeLessThanOrEqual(80);
		expect(coverage.fileDetailsTruncated).toBe(true);
	});

	it('uses the default ceiling when the supplied limit is not a finite integer', () => {
		const coverage = buildFileCoverage(
			{
				files: [file('src/a.ts')],
				filteredPaths: ['src/a.ts'],
				selectedPaths: ['src/a.ts'],
				reviewedPaths: ['src/a.ts'],
				failedGroups: 0,
			},
			Number.NaN
		);

		expect(coverage.files).toEqual([{ path: 'src/a.ts', status: 'reviewed' }]);
		expect(coverage.fileDetailsTruncated).toBe(false);
	});
});
