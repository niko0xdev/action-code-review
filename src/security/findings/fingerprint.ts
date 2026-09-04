import { createHash } from 'node:crypto';
import type { SecurityFinding } from '../types.js';

/**
 * Generate a stable fingerprint for a security finding.
 * Spec reference: §12.
 * Combination of normalized file path, category/CWE, and normalized sink/title.
 * Does NOT depend solely on line numbers because lines shift across commits.
 */
export function computeFindingFingerprint(
	finding: Partial<SecurityFinding> & { title: string },
	repo = ''
): string {
	const normalizedPath = (finding.file || '')
		.trim()
		.toLowerCase()
		.replace(/\\/g, '/');
	const categoryOrCwe = (finding.cwe || finding.category || 'general')
		.trim()
		.toLowerCase();
	const titleNormalized = finding.title
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
	const sinkNormalized = (finding.sink || finding.source || '')
		.trim()
		.toLowerCase()
		.slice(0, 100);

	const key = [
		repo.trim().toLowerCase(),
		normalizedPath,
		categoryOrCwe,
		titleNormalized,
		sinkNormalized,
	].join('::');

	return createHash('sha256').update(key).digest('hex').slice(0, 32);
}
