import { describe, it, expect, vi } from 'vitest';
import { resolveImportPath, resolveImportPaths } from '../src/dependencyResolver';
import type { OctokitType } from '../src/types';

describe('resolveImportPath', () => {
	let mockOctokit: OctokitType;
	const resolveOptions = {
		octokit: mockOctokit,
		owner: 'testowner',
		repo: 'testrepo',
		knownFiles: ['src/utils/helper.ts', 'lib/config.json', 'src/index.ts'],
	};

	beforeEach(() => {
		mockOctokit = {} as OctokitType;
	});

	it('should return null for node_modules imports', async () => {
		const result = await resolveImportPath(
			'node_modules/lodash',
			'src/index.ts',
			resolveOptions
		);

		expect(result).toBeNull();
	});

	it('should return null for scoped packages', async () => {
		const result = await resolveImportPath(
			'@types/react',
			'src/index.ts',
			resolveOptions
		);

		expect(result).toBeNull();
	});

	it('should return null for external packages', async () => {
		const result = await resolveImportPath(
			'react',
			'src/index.ts',
			resolveOptions
		);

		expect(result).toBeNull();
	});

	it('should resolve relative import to known file', async () => {
		const result = await resolveImportPath(
			'./utils/helper',
			'src/index.ts',
			resolveOptions
		);

		expect(result).toBe('src/utils/helper.ts');
	});

	it('should handle parent directory imports', async () => {
		const result = await resolveImportPath(
			'../config',
			'src/utils/helper.ts',
			resolveOptions
		);

		expect(result).toBe('lib/config.json');
	});

	it('should handle same-level imports', async () => {
		const result = await resolveImportPath(
			'./index',
			'src/utils/helper.ts',
			resolveOptions
		);

		expect(result).toBe('src/index.ts');
	});

	it('should return null for unknown files', async () => {
		const result = await resolveImportPath(
			'./unknown/file',
			'src/index.ts',
			resolveOptions
		);

		expect(result).toBeNull();
	});
});

describe('resolveImportPaths', () => {
	let mockOctokit: OctokitType;
	const resolveOptions = {
		octokit: mockOctokit,
		owner: 'testowner',
		repo: 'testrepo',
		knownFiles: ['src/utils/helper.ts', 'lib/config.json', 'src/index.ts'],
	};

	beforeEach(() => {
		mockOctokit = {} as OctokitType;
	});

	it('should resolve multiple import paths', async () => {
		const result = await resolveImportPaths(
			['./utils/helper', '../config'],
			'src/index.ts',
			resolveOptions
		);

		expect(result).toEqual(['src/utils/helper.ts', 'lib/config.json']);
	});

	it('should filter out external dependencies', async () => {
		const result = await resolveImportPaths(
			['./utils/helper', 'react', 'lodash'],
			'src/index.ts',
			resolveOptions
		);

		expect(result).toEqual(['src/utils/helper.ts']);
	});

	it('should remove duplicates', async () => {
		const result = await resolveImportPaths(
			['./utils/helper', './utils/helper'],
			'src/index.ts',
			resolveOptions
		);

		expect(result).toEqual(['src/utils/helper.ts']);
	});

	it('should handle empty import array', async () => {
		const result = await resolveImportPaths(
			[],
			'src/index.ts',
			resolveOptions
		);

		expect(result).toEqual([]);
	});
});

