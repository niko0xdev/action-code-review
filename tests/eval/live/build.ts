import type { ReviewContext } from '../../../src/types/context.js';
import { makeContext } from '../helpers/pipeline.js';
import type { EvalSeverity, LabelledFinding, ScoredCase } from '../scoring.js';
import { DEFECT_MARKER, type LiveCase } from './cases.js';

/** A published finding is a true positive within this many lines of a defect. */
export const LINE_TOLERANCE = 2;

export interface BuiltCase {
	id: string;
	cleanPr: boolean;
	filename: string;
	/** 1-based lines of the added file that carry a seeded defect. */
	defectLines: number[];
	context: ReviewContext;
}

/** Turn a case into a diff the model can review. Every line is an addition. */
export function buildCase(c: LiveCase): BuiltCase {
	const lines = c.source.replace(/\n$/, '').split('\n');
	const defectLines: number[] = [];
	const clean = lines.map((line, index) => {
		if (!line.includes(DEFECT_MARKER)) return line;
		defectLines.push(index + 1);
		return line.replace(DEFECT_MARKER, '').trimEnd();
	});
	const patch = `@@ -0,0 +1,${clean.length} @@\n${clean.map((l) => `+${l}`).join('\n')}`;
	return {
		id: c.id,
		cleanPr: defectLines.length === 0,
		filename: c.filename,
		defectLines,
		context: makeContext([{ filename: c.filename, status: 'added', patch }], {
			title: c.title,
			body: c.body,
		}),
	};
}

/**
 * Label findings against seeded defects. The first finding near a defect is the
 * true positive; further findings near an already-found defect are duplicates
 * of it and are not scored, so a chatty model is not charged twice for one bug.
 */
export function labelFindings(
	built: Pick<BuiltCase, 'filename' | 'defectLines'>,
	published: ReadonlyArray<{
		path: string;
		line: number;
		severity: EvalSeverity;
	}>
): Pick<ScoredCase, 'findings' | 'missed'> {
	const found = new Set<number>();
	const findings: LabelledFinding[] = [];
	for (const f of published) {
		const hit =
			f.path === built.filename
				? built.defectLines.find((d) => Math.abs(d - f.line) <= LINE_TOLERANCE)
				: undefined;
		if (hit === undefined) {
			findings.push({ label: 'fp', severity: f.severity });
		} else if (!found.has(hit)) {
			found.add(hit);
			findings.push({ label: 'tp', severity: f.severity });
		}
	}
	return { findings, missed: built.defectLines.length - found.size };
}
