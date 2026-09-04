import { describe, expect, it } from 'vitest';
import {
	validateFinding,
	validateFindings,
} from '../../src/review/validator.js';
import type { ChangedFile } from '../../src/types/context.js';
import type { Finding } from '../../src/types/finding.js';

function file(filename: string, patch: string): ChangedFile {
	return {
		filename,
		status: 'modified',
		additions: 2,
		deletions: 1,
		changes: 3,
		patch,
	};
}

const PATCH = [
	'@@ -10,4 +10,5 @@',
	' ctx',
	'+fresh line',
	'-stale',
	' tail',
].join('\n');

function baseFinding(overrides?: Partial<Finding>): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'correctness',
		path: 'src/a.ts',
		line: 11,
		title: 'Issue',
		description: 'd',
		impact: 'i',
		...overrides,
	};
}

describe('validateFindings (spec §18)', () => {
	it('keeps findings that pass every gate', () => {
		const files = [file('src/a.ts', PATCH)];
		const kept = validateFindings([baseFinding()], files, 0.8);
		expect(kept).toHaveLength(1);
	});

	it('drops findings below the confidence threshold', () => {
		const files = [file('src/a.ts', PATCH)];
		const kept = validateFindings(
			[baseFinding({ confidence: 0.6 })],
			files,
			0.8
		);
		expect(kept).toHaveLength(0);
	});

	it('drops findings whose path is not in the PR', () => {
		const files = [file('src/a.ts', PATCH)];
		const kept = validateFindings(
			[baseFinding({ path: 'other/b.ts' })],
			files,
			0.8
		);
		expect(kept).toHaveLength(0);
	});

	it('drops findings pointing at lines the PR did not touch', () => {
		const files = [file('src/a.ts', PATCH)];
		const kept = validateFindings([baseFinding({ line: 500 })], files, 0.8);
		expect(kept).toHaveLength(0);
	});

	it('accepts context lines within a hunk', () => {
		const files = [file('src/a.ts', PATCH)];
		const kept = validateFindings([baseFinding({ line: 10 })], files, 0.8);
		expect(kept).toHaveLength(1);
	});

	it('keeps distinct findings for dedupe stage', () => {
		const files = [file('src/a.ts', PATCH)];
		const kept = validateFindings(
			[baseFinding(), baseFinding({ title: 'Different words, same issue' })],
			files,
			0.8
		);
		expect(kept).toHaveLength(2);
	});
});

describe('validateFinding gates individually', () => {
	it.each([
		['valid finding passes', baseFinding(), true],
		['zero confidence fails', baseFinding({ confidence: 0 }), false],
		['empty path fails', baseFinding({ path: '' }), false],
	])('%s', (_name, findingValue, expected) => {
		const files = [file('src/a.ts', PATCH)];
		expect(validateFinding(findingValue, files, 0.8)).toBe(expected);
	});
});
