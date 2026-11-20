import { expect, it } from 'vitest';
import { graphHints } from '../../src/context/code-graph.js';
it('links relative imports only to known files', () => {
	expect(
		graphHints(
			new Map([
				['a.ts', "import { b } from './b'; b();"],
				['b.ts', 'export function b() {}'],
			])
		)
	).toEqual(['a.ts imports b.ts']);
});

it('omits ambiguous imports, oversized targets, and paths outside the repository', () => {
	expect(
		graphHints(
			new Map([
				['a.ts', "import './b'; import './large'; import '../escape';"],
				['b.ts', ''],
				['b.tsx', ''],
				['large.ts', ' '.repeat(32769)],
				['../escape.ts', ''],
			])
		)
	).toEqual([]);
});
