import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';

const MAX_FILES = 12;
const MAX_BYTES = 32_768;
const MAX_EDGES = 32;

export function graphPath(path: string): boolean {
	return (
		path.length <= 240 &&
		/^[\w./-]+\.tsx?$/.test(path) &&
		path.split('/').every((part) => part && part !== '.' && part !== '..')
	);
}

export function graphHints(files: ReadonlyMap<string, string>): string[] {
	const edges = new Set<string>();
	const eligible = new Map(
		[...files]
			.slice(0, MAX_FILES)
			.filter(
				([path, text]) =>
					graphPath(path) && Buffer.byteLength(text) <= MAX_BYTES
			)
	);
	for (const [path, text] of eligible) {
		const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
		for (const node of source.statements) {
			if (
				!ts.isImportDeclaration(node) ||
				!ts.isStringLiteral(node.moduleSpecifier)
			)
				continue;
			const specifier = node.moduleSpecifier.text;
			if (!(specifier.startsWith('./') || specifier.startsWith('../')))
				continue;
			const target = posix.join(posix.dirname(path), specifier);
			const stem = target.replace(/\.jsx?$/, '');
			const candidates = [
				...new Set([
					target,
					`${stem}.ts`,
					`${stem}.tsx`,
					`${stem}/index.ts`,
					`${stem}/index.tsx`,
				]),
			].filter((candidate) => graphPath(candidate) && eligible.has(candidate));
			if (candidates.length === 1)
				edges.add(`${path} imports ${candidates[0]}`);
			if (edges.size === MAX_EDGES) return [...edges];
		}
	}
	return [...edges];
}

const exec = promisify(execFile);

export async function loadGraphHints(
	paths: string[],
	head: string,
	root: string
): Promise<string[]> {
	if (!/^[a-f0-9]{40}$/i.test(head)) return [];
	const selected = [...new Set(paths)].filter(graphPath).slice(0, MAX_FILES);
	if (!selected.length) return [];
	const git = (args: string[], maxBuffer: number) =>
		exec(
			'git',
			['--no-replace-objects', '--literal-pathspecs', '-C', root, ...args],
			{
				maxBuffer,
				timeout: 1500,
				env: {
					PATH: process.env.PATH,
					LC_ALL: 'C',
					GIT_TERMINAL_PROMPT: '0',
					GIT_NO_LAZY_FETCH: '1',
				},
			}
		);
	const files = new Map<string, string>();
	try {
		const { stdout } = await git(
			['ls-tree', '-z', head, '--', ...selected],
			8192
		);
		for (const entry of stdout.split('\0')) {
			const match = /^100(?:644|755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
			if (!match || !selected.includes(match[2])) continue;
			try {
				const blob = await git(['cat-file', 'blob', match[1]], MAX_BYTES);
				files.set(match[2], blob.stdout);
			} catch {
				// Oversized or unavailable blobs do not contribute evidence.
			}
		}
	} catch {
		// A checkout without the pulled head has no graph evidence.
	}
	return graphHints(files);
}
