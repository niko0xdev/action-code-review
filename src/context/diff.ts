/**
 * Unified-diff helpers. Findings must anchor to new-side line numbers so
 * GitHub can place inline comments; these utilities do that mapping.
 */

export interface HunkHeader {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
}

export type PatchLineType = 'context' | 'addition' | 'deletion';

export interface PatchLine {
	type: PatchLineType;
	/** 1-based line in the post-change file; undefined for deletions. */
	newLine?: number;
	content?: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedHunkHeader(line: string): HunkHeader | null {
	const match = line.match(HUNK_RE);
	if (!match) {
		return null;
	}
	return {
		oldStart: Number(match[1]),
		oldLines: match[2] ? Number(match[2]) : 1,
		newStart: Number(match[3]),
		newLines: match[4] ? Number(match[4]) : 1,
	};
}

/** Map every patch line to its new-side position across all hunks. */
export function mapPatchLines(patch: string): PatchLine[] {
	const mapped: PatchLine[] = [];
	let currentNewLine: number | null = null;

	for (const raw of patch.split('\n')) {
		const header = parseUnifiedHunkHeader(raw);
		if (header) {
			currentNewLine = header.newStart;
			continue;
		}
		if (raw.startsWith('diff ') || raw.startsWith('index ')) {
			continue;
		}
		if (currentNewLine === null) {
			continue;
		}
		if (raw.startsWith('+')) {
			mapped.push({ type: 'addition', newLine: currentNewLine, content: raw });
			currentNewLine += 1;
		} else if (raw.startsWith('-')) {
			mapped.push({ type: 'deletion', content: raw });
		} else if (raw.startsWith('\\')) {
			// "\ No newline at end of file" — no line consumed
		} else {
			mapped.push({ type: 'context', newLine: currentNewLine, content: raw });
			currentNewLine += 1;
		}
	}
	return mapped;
}

/**
 * True when `line` points at a line the PR touched on the new side
 * (an addition or a context line inside a hunk — both are commentable).
 */
export function isChangedLine(patch: string, line: number): boolean {
	return mapPatchLines(patch).some(
		(mapped) => mapped.newLine === line && mapped.type !== 'deletion'
	);
}
