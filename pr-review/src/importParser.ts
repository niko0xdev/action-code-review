export function parseImports(content: string, filename: string): string[] {
	const extension = filename.split('.').pop()?.toLowerCase();
	const imports: string[] = [];

	if (!extension) {
		return imports;
	}

	switch (extension) {
		case 'ts':
		case 'tsx':
		case 'js':
		case 'jsx':
			imports.push(...parseTypeScriptImports(content));
			break;
		case 'py':
			imports.push(...parsePythonImports(content));
			break;
		case 'go':
			imports.push(...parseGoImports(content));
			break;
		case 'rs':
			imports.push(...parseRustImports(content));
			break;
		default:
			// For other languages, try to detect common import patterns
			imports.push(...parseGenericImports(content));
	}

	return imports;
}

function parseTypeScriptImports(content: string): string[] {
	const imports: string[] = [];
	const patterns = [
		// ES6 imports: import { x } from 'path'
		/import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"`]([^'"`]+)['"`]/g,
		// ES6 default imports: import x from 'path'
		/import\s+\w+\s+from\s+['"`]([^'"`]+)['"`]/g,
		// ES6 side-effect imports: import 'path'
		/import\s+['"`]([^'"`]+)['"`]/g,
		// Dynamic imports: import('path')
		/import\(['"`]([^'"`]+)['"`]\)/g,
		// CommonJS requires: require('path')
		/require\(['"`]([^'"`]+)['"`]\)/g,
		// TypeScript type imports: import type { x } from 'path'
		/import\s+type\s+\{[^}]*\}\s+from\s+['"`]([^'"`]+)['"`]/g,
	];

	for (const pattern of patterns) {
		let match;
		while ((match = pattern.exec(content)) !== null) {
			const importPath = match[1];
			if (importPath && !imports.includes(importPath)) {
				imports.push(importPath);
			}
		}
	}

	return imports;
}

function parsePythonImports(content: string): string[] {
	const imports: string[] = [];

	for (const line of content.split('\n')) {
		const trimmed = line.trim();

		// Match: from module import x
		const fromMatch = trimmed.match(/^from\s+(\S+)\s+import/);
		if (fromMatch) {
			const path = fromMatch[1];
			if (!imports.includes(path)) {
				imports.push(path);
			}
			continue;
		}

		// Match: import x from module
		const importMatch = trimmed.match(
			/^import\s+\w+(?:\s*,\s*\w+)*\s+from\s+(\S+)/
		);
		if (importMatch) {
			const path = importMatch[1];
			if (!imports.includes(path)) {
				imports.push(path);
			}
			continue;
		}

		// Match: import module
		const directMatch = trimmed.match(/^import\s+(\S+)/);
		if (directMatch) {
			const path = directMatch[1];
			if (!imports.includes(path)) {
				imports.push(path);
			}
		}
	}

	return imports;
}

function parseGoImports(content: string): string[] {
	const imports: string[] = [];

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		const match = trimmed.match(/^import\s+\("([^"]+)"\s+/);
		if (match) {
			const importPath = match[1].replace(/"/g, '');
			if (importPath && !imports.includes(importPath)) {
				imports.push(importPath);
			}
		}
	}

	return imports;
}

function parseRustImports(content: string): string[] {
	const imports: string[] = [];
	const patterns = [
		// use module::x;
		/use\s+(\S+)::/g,
		// mod x;
		/mod\s+(\w+);/g,
		// extern crate x;
		/extern\s+crate\s+(\w+);/g,
	];

	for (const pattern of patterns) {
		let match;
		while ((match = pattern.exec(content)) !== null) {
			const importPath = match[1];
			if (importPath && !imports.includes(importPath)) {
				imports.push(importPath);
			}
		}
	}

	return imports;
}

function parseGenericImports(content: string): string[] {
	const imports: string[] = [];
	// Generic patterns that work across many languages
	const patterns = [
		/include\s+['"`]([^'"`]+)['"`]/g,
		/from\s+['"`]([^'"`]+)['"`]/g,
		/require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
	];

	for (const pattern of patterns) {
		let match;
		while ((match = pattern.exec(content)) !== null) {
			const importPath = match[1];
			if (importPath && !imports.includes(importPath)) {
				imports.push(importPath);
			}
		}
	}

	return imports;
}
