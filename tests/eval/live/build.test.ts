import { describe, expect, it } from 'vitest';
import { buildCase, labelFindings } from './build.js';
import { DEFECT_MARKER, LIVE_CASES } from './cases.js';

describe('live case builder', () => {
	it('has unique ids and a balanced seeded and clean set', () => {
		const built = LIVE_CASES.map(buildCase);
		expect(new Set(built.map((b) => b.id)).size).toBe(built.length);
		expect(built.filter((b) => !b.cleanPr)).toHaveLength(10);
		expect(built.filter((b) => b.cleanPr)).toHaveLength(10);
	});

	it('seeds exactly one defect per defective case and hides the marker', () => {
		for (const c of LIVE_CASES) {
			const b = buildCase(c);
			const patch = b.context.diff.files[0].patch ?? '';
			expect(patch).not.toContain(DEFECT_MARKER);
			expect(b.defectLines.length).toBe(b.cleanPr ? 0 : 1);
		}
	});

	it('anchors the defect to the right added line', () => {
		const b = buildCase(LIVE_CASES[0]);
		const patchLines = (b.context.diff.files[0].patch ?? '').split('\n');
		// Line 1 of the file is patchLines[1] (after the hunk header).
		expect(patchLines[b.defectLines[0]]).toContain('i <= lines.length');
	});

	it('labels hits, misses, and duplicates', () => {
		const built = { filename: 'src/a.ts', defectLines: [10] };
		const sev = 'high' as const;
		expect(
			labelFindings(built, [
				{ path: 'src/a.ts', line: 12, severity: sev },
				{ path: 'src/a.ts', line: 10, severity: sev },
				{ path: 'src/a.ts', line: 30, severity: sev },
				{ path: 'src/b.ts', line: 10, severity: sev },
			])
		).toEqual({
			findings: [
				{ label: 'tp', severity: 'high' },
				{ label: 'fp', severity: 'high' },
				{ label: 'fp', severity: 'high' },
			],
			missed: 0,
		});
		expect(labelFindings(built, [])).toEqual({ findings: [], missed: 1 });
		expect(
			labelFindings({ filename: 'src/a.ts', defectLines: [] }, [
				{ path: 'src/a.ts', line: 1, severity: 'low' },
			]).missed
		).toBe(0);
	});
});
