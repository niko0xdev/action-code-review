import { isChangedLine } from '../context/diff.js';
import type { ChangedFile } from '../types/context.js';
import type { Finding } from '../types/finding.js';

/**
 * Finding validation pipeline (spec §18). Nothing reaches GitHub without
 * passing: valid path → changed by PR → confidence floor → not a duplicate.
 */

export interface ValidationOptions {
	/** Confidence floor; spec default 0.80. */
	minConfidence?: number;
}

export function validateFinding(
	finding: Finding,
	changedFiles: ChangedFile[],
	minConfidence: number
): boolean {
	if (!finding.path || finding.line < 1) {
		return false;
	}
	const file = changedFiles.find((f) => f.filename === finding.path);
	if (!file) {
		return false;
	}
	if (
		typeof finding.confidence !== 'number' ||
		finding.confidence < minConfidence
	) {
		return false;
	}
	if (!file.patch) {
		return false;
	}
	return isChangedLine(file.patch, finding.line);
}

export function validateFindings(
	findings: Finding[],
	changedFiles: ChangedFile[],
	minConfidence = 0.8
): Finding[] {
	const seenSignatures = new Set<string>();
	const kept: Finding[] = [];

	for (const finding of findings) {
		if (!validateFinding(finding, changedFiles, minConfidence)) {
			continue;
		}
		const signature = `${finding.path}|${finding.line}|${finding.category}`;
		if (seenSignatures.has(signature)) {
			continue;
		}
		seenSignatures.add(signature);
		kept.push(finding);
	}
	return kept;
}
