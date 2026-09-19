/**
 * Repository-relative path helpers shared by review reporting.
 */

export function normalizeRepoPath(path: string): string {
	return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isTestPath(path: string): boolean {
	const normalized = normalizeRepoPath(path);
	return (
		normalized.startsWith('tests/') ||
		normalized.includes('.test.') ||
		normalized.includes('.spec.')
	);
}
