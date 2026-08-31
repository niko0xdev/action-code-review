import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	type PrelintResult,
	type ToolRunner,
	defaultTools,
	findBinary,
	renderToolFindingsForPrompt,
	runPrelint,
} from '../../src/context/prelint.js';
import type { ChangedFile } from '../../src/types/context.js';

const scratch = join(tmpdir(), `acr-v2-prelint-${process.pid}`);

function makeRepo(files: Record<string, string>): string {
	mkdirSync(scratch, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(scratch, path);
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, content);
	}
	return scratch;
}

function changedFile(filename: string, status = 'modified'): ChangedFile {
	return {
		filename,
		status: status as ChangedFile['status'],
		additions: 1,
		deletions: 0,
		changes: 1,
	};
}

afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe('findBinary', () => {
	it('returns null when binary is missing', () => {
		mkdirSync(scratch, { recursive: true });
		expect(findBinary(scratch, 'definitely-not-a-real-binary')).toBeNull();
	});

	it('finds an executable in node_modules/.bin', () => {
		const binDir = join(scratch, 'node_modules', '.bin');
		mkdirSync(binDir, { recursive: true });
		const fake = join(binDir, 'myfakebin');
		writeFileSync(fake, '#!/bin/sh\necho ok\n');
		expect(findBinary(scratch, 'myfakebin')).toBe(fake);
	});

	it('finds .cmd shim on Windows-style paths', () => {
		const binDir = join(scratch, 'node_modules', '.bin');
		mkdirSync(binDir, { recursive: true });
		const fake = join(binDir, 'myfakebin.cmd');
		writeFileSync(fake, '@echo off\r\necho ok\r\n');
		expect(findBinary(scratch, 'myfakebin')).toBe(fake);
	});
});

describe('defaultTools', () => {
	it('returns biome + ruff by default', () => {
		const ids = defaultTools().map((t) => t.id);
		expect(ids).toContain('biome');
		expect(ids).toContain('ruff');
	});
});

describe('runPrelint - no binary available', () => {
	it('skips tools when no binary is found, returns empty findings', async () => {
		const repo = makeRepo({
			'src/app.ts': 'export const x = 1;',
			'main.py': 'x = 1',
		});
		const result = await runPrelint({
			repositoryPath: repo,
			changedFiles: [changedFile('src/app.ts'), changedFile('main.py')],
		});
		expect(result.findings).toEqual([]);
		expect(result.ran).toEqual([]);
		expect(result.skipped.length).toBeGreaterThan(0);
		expect(result.skipped.some((s) => s.startsWith('biome'))).toBe(true);
		expect(result.skipped.some((s) => s.startsWith('ruff'))).toBe(true);
	});

	it('skips a tool when no changed files match its file filter', async () => {
		const binDir = join(scratch, 'node_modules', '.bin');
		mkdirSync(binDir, { recursive: true });
		const fakeBin = join(binDir, 'biome');
		writeFileSync(fakeBin, '#!/bin/sh\necho "[]"\n');
		makeRepo({ 'main.py': 'x = 1' });

		const result = await runPrelint({
			repositoryPath: scratch,
			changedFiles: [changedFile('main.py')],
		});
		const biomeStatus = result.skipped.find((s) => s.startsWith('biome'));
		expect(biomeStatus).toContain('no matching files');
	});
});

describe('runPrelint - custom runner', () => {
	it('invokes the provided runner and aggregates findings', async () => {
		makeRepo({ 'src/app.ts': '' });

		const fakeRunner: ToolRunner = {
			id: 'fake',
			isAvailable: () => true,
			matches: (file) => file.filename.endsWith('.ts'),
			run: async ({ files }) =>
				files.map((f, i) => ({
					tool: 'fake',
					code: `FAKE${i}`,
					path: f.filename,
					line: 1,
					severity: 'medium' as const,
					message: `fake finding for ${f.filename}`,
				})),
		};

		const result = await runPrelint({
			repositoryPath: scratch,
			changedFiles: [
				changedFile('src/app.ts'),
				changedFile('src/lib.ts'),
				changedFile('main.py'),
			],
			tools: [fakeRunner],
		});

		expect(result.findings).toHaveLength(2);
		expect(result.findings.map((f) => f.path).sort()).toEqual([
			'src/app.ts',
			'src/lib.ts',
		]);
		expect(result.ran).toEqual(['fake']);
		expect(result.skipped).toEqual([]);
	});

	it('catches runner errors and reports them as skipped', async () => {
		makeRepo({ 'src/app.ts': '' });

		const brokenRunner: ToolRunner = {
			id: 'broken',
			isAvailable: () => true,
			matches: () => true,
			run: async () => {
				throw new Error('boom');
			},
		};

		const result = await runPrelint({
			repositoryPath: scratch,
			changedFiles: [changedFile('src/app.ts')],
			tools: [brokenRunner],
		});

		expect(result.findings).toEqual([]);
		expect(result.ran).toEqual([]);
		expect(result.skipped).toContain('broken (boom)');
	});

	it('skips a tool when isAvailable returns false', async () => {
		makeRepo({ 'src/app.ts': '' });

		const unavailable: ToolRunner = {
			id: 'gone',
			isAvailable: () => false,
			matches: () => true,
			run: async () => [],
		};

		const result = await runPrelint({
			repositoryPath: scratch,
			changedFiles: [changedFile('src/app.ts')],
			tools: [unavailable],
		});

		expect(result.skipped).toContain('gone (binary not found)');
		expect(result.ran).toEqual([]);
	});
});

describe('renderToolFindingsForPrompt', () => {
	it('returns placeholder when no findings', () => {
		expect(renderToolFindingsForPrompt([])).toBe(
			'(no static-analyzer findings)'
		);
	});

	it('renders findings as markdown bullet lines', () => {
		const result = renderToolFindingsForPrompt([
			{
				tool: 'biome',
				code: 'no-unused-vars',
				path: 'src/app.ts',
				line: 42,
				severity: 'medium',
				message: 'unused variable x',
			},
		]);
		expect(result).toContain('Static-analyzer findings');
		expect(result).toContain('[biome/no-unused-vars] src/app.ts:42');
		expect(result).toContain('unused variable x');
	});

	it('caps output at maxLines and emits a trailing counter', () => {
		const many = Array.from({ length: 100 }, (_, i) => ({
			tool: 'biome',
			code: `R${i}`,
			path: `src/file${i}.ts`,
			line: i + 1,
			severity: 'low' as const,
			message: `msg ${i}`,
		}));
		const result = renderToolFindingsForPrompt(many, 5);
		expect(result).toContain('R0');
		expect(result).not.toContain('R5');
		expect(result).toContain('... and 95 more findings');
	});
});

describe('PrelintResult shape', () => {
	it('has findings, ran, skipped fields', async () => {
		const result: PrelintResult = await runPrelint({
			repositoryPath: scratch,
			changedFiles: [],
		});
		expect(Array.isArray(result.findings)).toBe(true);
		expect(Array.isArray(result.ran)).toBe(true);
		expect(Array.isArray(result.skipped)).toBe(true);
	});
});
