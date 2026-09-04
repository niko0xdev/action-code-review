import { describe, expect, it } from 'vitest';
import {
	type PatchLine,
	isChangedLine,
	mapPatchLines,
	parseUnifiedHunkHeader,
} from '../../src/context/diff.js';

describe('parseUnifiedHunkHeader', () => {
	it('parses a standard hunk header', () => {
		const header = parseUnifiedHunkHeader('@@ -12,5 +14,7 @@ context');
		expect(header).toEqual({
			oldStart: 12,
			oldLines: 5,
			newStart: 14,
			newLines: 7,
		});
	});

	it('parses a hunk with omitted line counts', () => {
		expect(parseUnifiedHunkHeader('@@ -3 +3 @@')).toEqual({
			oldStart: 3,
			oldLines: 1,
			newStart: 3,
			newLines: 1,
		});
	});

	it('returns null for non-headers', () => {
		expect(parseUnifiedHunkHeader('+added line')).toBeNull();
	});
});

describe('mapPatchLines', () => {
	function patch(lines: string[]): string {
		return ['@@ -1,4 +1,4 @@', ...lines].join('\n');
	}

	it('assigns new-side line numbers to additions and context', () => {
		const mapped = mapPatchLines(
			patch([' unchanged', '+added one', '+added two'])
		);
		expect(mapped.filter((l) => l.type === 'context')).toEqual([
			{
				type: 'context',
				newLine: 1,
				content: ' unchanged',
			} satisfies PatchLine,
		]);
		expect(mapped.filter((l) => l.type === 'addition')).toEqual([
			{
				type: 'addition',
				newLine: 2,
				content: '+added one',
			} satisfies PatchLine,
			{
				type: 'addition',
				newLine: 3,
				content: '+added two',
			} satisfies PatchLine,
		]);
	});

	it('leaves deletions without a new-side number', () => {
		const mapped = mapPatchLines(patch(['-gone', '-also gone']));
		expect(mapped.filter((l) => l.type === 'deletion')).toEqual([
			{ type: 'deletion', content: '-gone' } satisfies PatchLine,
			{ type: 'deletion', content: '-also gone' } satisfies PatchLine,
		]);
	});

	it('tracks multiple hunks with correct offsets', () => {
		const multiPatch = [
			'@@ -1,2 +1,3 @@',
			' a',
			'+b',
			' c',
			'@@ -20,1 +22,1 @@',
			'-old',
			'+new',
		].join('\n');
		const mapped = mapPatchLines(multiPatch);
		const added = mapped
			.filter((l) => l.type === 'addition')
			.map((l) => l.newLine);
		expect(added).toEqual([2, 22]);
	});
});

describe('isChangedLine', () => {
	const patchText = [
		'@@ -10,3 +10,4 @@',
		' ctx',
		'+new code',
		'-old code',
	].join('\n');

	it('accepts additions on the new side', () => {
		expect(isChangedLine(patchText, 11)).toBe(true);
	});

	it('accepts context lines inside hunks (commentable)', () => {
		expect(isChangedLine(patchText, 10)).toBe(true);
	});

	it('rejects lines outside any hunk', () => {
		expect(isChangedLine(patchText, 500)).toBe(false);
	});
});
