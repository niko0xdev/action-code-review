import { createHash } from 'node:crypto';
import type { Finding } from '../types/finding.js';

/**
 * Finding deduplication (spec §18) and the legacy-compatible comment id
 * format (docs/v1-interface-contract.md): 12-hex SHA-256 over
 * path|line|body|ruleId so V2 comments participate in the same duplicate
 * suppression as V1.
 */

export function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function dedupeKey(finding: Finding): string {
	return [
		finding.path,
		finding.line,
		finding.category,
		normalizeTitle(finding.title).split(' ').slice(0, 4).join(' '),
	].join('|');
}

/** Remove duplicates, keeping the highest-confidence copy of each. */
export function dedupeFindings(findings: Finding[]): Finding[] {
	const best = new Map<string, Finding>();
	for (const finding of findings) {
		const key = dedupeKey(finding);
		const existing = best.get(key);
		if (!existing || finding.confidence > existing.confidence) {
			best.set(key, finding);
		}
	}
	return [...best.values()];
}

/** Legacy-compatible stable comment id (12 hex chars). */
export function normalizeCommentId(finding: Finding): string {
	const hash = createHash('sha256');
	hash.update(
		[
			finding.path,
			finding.line.toString(),
			buildCommentBody(finding).trim(),
			'',
		].join('|')
	);
	return hash.digest('hex').slice(0, 12);
}

function buildCommentBody(finding: Finding): string {
	return [finding.title, finding.description, finding.impact]
		.filter(Boolean)
		.join('\n\n');
}
