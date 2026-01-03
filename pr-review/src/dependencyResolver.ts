import type { OctokitType } from './types';

interface ResolveOptions {
	octokit: OctokitType;
	owner: string;
	repo: string;
	knownFiles: string[];
}

/**
 * Resolve a single import path to an actual file path
 */
export async function resolveImportPath(
	importPath: string,
	currentFile: string,
	options: ResolveOptions
): Promise<string | null> {
	// Skip external packages and node_modules
	if (isExternalDependency(importPath)) {
		return null;
	}

	// Convert import path to potential file paths
	const potentialPaths = getPotentialPaths(importPath, currentFile);

	// Check if any potential path matches known files
	for (const path of potentialPaths) {
		if (options.knownFiles.includes(path)) {
			return path;
		}
	}

	return null;
}

/**
 * Resolve multiple import paths to actual files
 */
export async function resolveImportPaths(
	importPaths: string[],
	currentFile: string,
	options: ResolveOptions
): Promise<string[]> {
	const resolved: string[] = [];

	for (const importPath of importPaths) {
		const resolvedPath = await resolveImportPath(
			importPath,
			currentFile,
			options
		);
		if (resolvedPath && !resolved.includes(resolvedPath)) {
			resolved.push(resolvedPath);
		}
	}

	return resolved;
}

/**
 * Check if an import is an external dependency
 */
function isExternalDependency(importPath: string): boolean {
	// Skip node_modules
	if (importPath.includes('node_modules')) {
		return true;
	}

	// Skip if it starts with @ (scoped package)
	if (importPath.startsWith('@')) {
		return true;
	}

	// Skip if it's a package name without path separator
	// and doesn't start with . or /
	if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
		// Check if it looks like a package name (no path separators or only one at most)
		const parts = importPath.split('/');
		if (parts.length <= 2 && !parts[0].startsWith('.')) {
			return true;
		}
	}

	return false;
}

/**
 * Generate potential file paths from an import path
 */
function getPotentialPaths(importPath: string, currentFile: string): string[] {
	const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/'));
	const paths: string[] = [];

	// Handle relative imports
	if (importPath.startsWith('.')) {
		// Normalize relative path
		const normalizedPath = normalizeRelativePath(importPath, currentDir);
		paths.push(normalizedPath);

		// Try common extensions
		const extensions = [
			'.ts',
			'.tsx',
			'.js',
			'.jsx',
			'.json',
			'.py',
			'.go',
			'.rs',
		];
		for (const ext of extensions) {
			paths.push(normalizedPath + ext);

			// Try index files
			if (normalizedPath.endsWith('/')) {
				paths.push(normalizedPath + 'index' + ext);
			}
		}

		return paths;
	}

	// Handle absolute imports from project root
	if (importPath.startsWith('/')) {
		const absolutePath = importPath.substring(1); // Remove leading /
		paths.push(absolutePath);

		const extensions = [
			'.ts',
			'.tsx',
			'.js',
			'.jsx',
			'.json',
			'.py',
			'.go',
			'.rs',
		];
		for (const ext of extensions) {
			paths.push(absolutePath + ext);

			if (absolutePath.endsWith('/')) {
				paths.push(absolutePath + 'index' + ext);
			}
		}

		return paths;
	}

	// Handle package-style imports (assuming src/ or lib/ structure)
	const commonPrefixes = ['src/', 'lib/', ''];
	for (const prefix of commonPrefixes) {
		const fullPath = prefix + importPath;
		paths.push(fullPath);

		const extensions = [
			'.ts',
			'.tsx',
			'.js',
			'.jsx',
			'.json',
			'.py',
			'.go',
			'.rs',
		];
		for (const ext of extensions) {
			paths.push(fullPath + ext);

			if (fullPath.endsWith('/')) {
				paths.push(fullPath + 'index' + ext);
			}
		}
	}

	return paths;
}

/**
 * Normalize a relative path relative to a base directory
 */
function normalizeRelativePath(relativePath: string, baseDir: string): string {
	// Remove leading ./ if present
	let path = relativePath.replace(/^\.\//, '');

	// Split into segments
	const segments = path.split('/');
	const result: string[] = [];

	for (const segment of segments) {
		if (segment === '..') {
			// Go up one directory
			const lastIdx = baseDir.lastIndexOf('/');
			if (lastIdx !== -1) {
				baseDir = baseDir.substring(0, lastIdx);
			}
		} else if (segment !== '.') {
			result.push(segment);
		}
	}

	return baseDir ? `${baseDir}/${result.join('/')}` : result.join('/');
}
