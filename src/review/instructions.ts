import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as core from '@actions/core';
import { fenced } from '../shared/prompt-safety.js';
import {
	type BaseResult,
	type PromptFileOptions,
	readFromApi,
	readFromGit,
} from './prompt-file.js';

const run = promisify(execFile);

/** Instruction files read from the repository root, in this order. */
const FIXED_FILES = ['AGENTS.md', '.github/copilot-instructions.md'];
/** Directory of path-scoped `*.instructions.md` files (`applyTo` front matter). */
const SCOPED_DIR = '.github/instructions';
const SCOPED_SUFFIX = '.instructions.md';
const MAX_SCOPED_FILES = 20;
/** Directory entries considered before `applyTo` matching. */
const MAX_LISTED_FILES = 200;
/** Budget for all instruction text together, after the 50 KiB per-file cap. */
const MAX_TOTAL_CHARS = 64 * 1024;

export interface RepositoryInstructionsOptions {
	repoPath: string;
	/** Pull request base SHA; nothing is read without it. */
	baseSha?: string;
	/** Paths the pull request changes, for `applyTo` scoping. */
	changedPaths: readonly string[];
	fetchBase?: PromptFileOptions['fetchBase'];
}

export interface RepositoryInstructions {
	/** Prompt text, one fenced block per file; empty when nothing applies. */
	text: string;
	/** Repository paths that contributed, in prompt order. */
	files: string[];
}

/** Most `**` segments a glob may use; more could make matching costly. */
const MAX_GLOBSTARS = 2;
/**
 * Most wildcards a glob may use in total, and its longest length. Overlapping
 * wildcards make a failing match expensive, so a pattern beyond these bounds
 * is skipped rather than compiled.
 */
const MAX_GLOB_WILDCARDS = 8;
const MAX_GLOB_LENGTH = 200;

/** Split on commas outside `{...}` brace sets. */
function splitTopLevel(value: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const char of value) {
		if (char === '{') depth += 1;
		else if (char === '}') depth = Math.max(0, depth - 1);
		if (char === ',' && depth === 0) {
			parts.push(current);
			current = '';
		} else current += char;
	}
	parts.push(current);
	return parts;
}

function globBody(glob: string): string {
	let out = '';
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		if (char === '*' && glob[i + 1] === '*') {
			const slash = glob[i + 2] === '/';
			out += slash ? '(?:.*/)?' : '.*';
			i += slash ? 2 : 1;
		} else if (char === '*') out += '[^/]*';
		else if (char === '?') out += '[^/]';
		else if (char === '{') {
			// One level of `{a,b}`; anything else stays literal.
			const close = glob.indexOf('}', i);
			const inner = close > i ? glob.slice(i + 1, close) : '';
			if (close > i && inner.includes(',') && !inner.includes('{')) {
				out += `(?:${inner.split(',').map(globBody).join('|')})`;
				i = close;
			} else out += '\\{';
		} else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return out;
}

/**
 * Glob as used by `applyTo`: `**` spans directories, `*` and `?` stay inside
 * one path segment, `{a,b}` is one level of alternatives, everything else is
 * literal. Built from escaped literals and bounded classes; callers reject
 * globs with more than two `**`, which keeps backtracking bounded.
 */
export function globToRegExp(glob: string): RegExp {
	return new RegExp(`^${globBody(glob)}$`);
}

interface ScopedFile {
	body: string;
	/** True when front matter declares `applyTo`, even if empty. */
	declared: boolean;
	applyTo: string[];
	/** `excludeAgent: code-review` keeps the file out of code review. */
	excluded: boolean;
}

/**
 * Remove a trailing comment that is not inside a quoted string, so a quoted
 * glob in a comment is never read as a rule.
 */
function stripComment(value: string): string {
	let quote = '';
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (quote) {
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '#') return value.slice(0, i).trim();
	}
	return value.trim();
}

/** A value made only of quoted strings, optionally comma separated. */
const QUOTED_ONLY = /^(?:"[^"]*"|'[^']*')(?:\s*,\s*(?:"[^"]*"|'[^']*'))*$/;

/** Normalise one `applyTo` entry: quotes, a leading `./` or `/`. */
function cleanGlob(raw: string): string {
	return raw
		.trim()
		.replace(/^(["'])(.*)\1$/, '$2')
		.trim()
		.replace(/^\.?\//, '');
}

/** Read `applyTo` as a string, quoted strings, an inline list, or a block list. */
function parseApplyTo(lines: string[], index: number): string[] {
	const rest = lines[index].replace(/^applyTo:/, '').trim();
	let raw: string[];
	if (!rest) {
		raw = [];
		for (let i = index + 1; i < lines.length; i++) {
			const item = /^\s*-\s*(.+)$/.exec(lines[i]);
			if (!item) break;
			raw.push(stripComment(item[1]));
		}
	} else if (rest.startsWith('[')) {
		raw = splitTopLevel(stripComment(rest).replace(/^\[|\][^\]]*$/g, ''));
	} else {
		const withoutComment = stripComment(rest);
		// Quoted strings are only read as separate globs when the value is
		// nothing but quoted strings; a quoted glob inside a comment is not a
		// rule.
		const quoted = QUOTED_ONLY.test(withoutComment)
			? [...withoutComment.matchAll(/"([^"]*)"|'([^']*)'/g)].map(
					(m) => m[1] ?? m[2]
				)
			: [];
		raw = quoted.length > 0 ? quoted : [withoutComment];
	}
	return raw.flatMap(splitTopLevel).map(cleanGlob).filter(Boolean);
}

/** Split `---` front matter from the body and read `applyTo` and `excludeAgent`. */
function parseScoped(text: string): ScopedFile {
	const source = text.replace(/^\uFEFF/, '');
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
	if (!match)
		return { body: source, declared: false, applyTo: [], excluded: false };
	const lines = match[1].split(/\r?\n/);
	const index = lines.findIndex((line) => /^applyTo:/.test(line));
	const exclude = lines.find((line) => /^excludeAgent:/.test(line)) ?? '';
	// The value is compared exactly: a comment that mentions another agent
	// must not exclude this file.
	const excluded =
		/^excludeAgent:[ \t]*["']?([A-Za-z0-9_-]+)["']?[ \t]*$/.exec(
			exclude.trim()
		)?.[1] === 'code-review';
	return {
		body: source.slice(match[0].length),
		declared: index >= 0,
		applyTo: index >= 0 ? parseApplyTo(lines, index) : [],
		excluded,
	};
}

async function readBase(
	opts: RepositoryInstructionsOptions,
	baseSha: string,
	rel: string
): Promise<BaseResult> {
	let base = await readFromGit(opts.repoPath, baseSha, rel);
	if (base.kind === 'unavailable' && opts.fetchBase)
		base = await readFromApi(opts.fetchBase, baseSha, rel);
	return base;
}

/** Names of regular `*.instructions.md` files directly under SCOPED_DIR at base. */
async function listScoped(
	opts: RepositoryInstructionsOptions,
	baseSha: string
): Promise<string[]> {
	const keep = (name: string) =>
		name.endsWith(SCOPED_SUFFIX) && !name.includes('/');
	try {
		const { stdout } = await run(
			'git',
			['-C', opts.repoPath, 'ls-tree', baseSha, '--', `${SCOPED_DIR}/`],
			{
				env: { PATH: process.env.PATH, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
				maxBuffer: 256 * 1024,
				timeout: 10_000,
			}
		);
		return stdout
			.split('\n')
			.map((line) => /^100(?:644|755) blob [0-9a-f]+\t(.+)$/.exec(line)?.[1])
			.filter((path): path is string => Boolean(path))
			.map((path) => path.slice(SCOPED_DIR.length + 1))
			.filter(keep)
			.sort();
	} catch {
		if (!opts.fetchBase) return [];
		try {
			const listing = await opts.fetchBase(SCOPED_DIR, baseSha);
			if (!Array.isArray(listing)) return [];
			return listing
				.filter((entry) => entry.type === 'file')
				.map((entry) => (entry as { name?: string }).name ?? '')
				.filter(keep)
				.sort();
		} catch {
			return [];
		}
	}
}

/**
 * Load repository instruction files for the trusted rules slot: `AGENTS.md`,
 * `.github/copilot-instructions.md`, and `.github/instructions/*.instructions.md`
 * whose `applyTo` globs match a changed path. Only the copies at the pull
 * request's base commit are used, so a pull request cannot change the rules it
 * is reviewed against; without a base commit nothing is read. Each file keeps
 * the 50 KiB cap of `review-prompt-file`, the total is capped, and each file is
 * fenced so its text cannot pose as part of the prompt.
 */
export async function loadRepositoryInstructions(
	opts: RepositoryInstructionsOptions
): Promise<RepositoryInstructions> {
	const empty = { text: '', files: [] };
	const baseSha = opts.baseSha;
	if (!baseSha || !/^[0-9a-f]{40,64}$/i.test(baseSha)) return empty;
	const listed = await listScoped(opts, baseSha);
	if (listed.length > MAX_LISTED_FILES)
		core.warning(
			`[review] more than ${MAX_LISTED_FILES} instruction files exist; only the first ${MAX_LISTED_FILES} were considered`
		);
	const scoped = listed
		.slice(0, MAX_LISTED_FILES)
		.map((name) => `${SCOPED_DIR}/${name}`);
	const blocks: string[] = [];
	const files: string[] = [];
	const seen = new Set<string>();
	let used = 0;
	let matchedScoped = 0;
	for (const path of [...FIXED_FILES, ...scoped]) {
		const base = await readBase(opts, baseSha, path);
		if (base.kind === 'ignore') {
			core.warning(`[review] instruction file ${path} ${base.why} – ignored`);
			continue;
		}
		if (base.kind !== 'content') continue;
		// `excludeAgent: code-review` keeps a file out of the review, whether
		// it is one of the fixed files or a scoped one.
		if (parseScoped(base.text).excluded) continue;
		let body = base.text.replace(/^\uFEFF/, '');
		if (path.startsWith(`${SCOPED_DIR}/`)) {
			const parsed = parseScoped(body);
			if (parsed.excluded) continue;
			const globs = parsed.applyTo.filter((glob) => {
				const wildcards = (glob.match(/[*?]/g) ?? []).length;
				if (wildcards > MAX_GLOB_WILDCARDS || glob.length > MAX_GLOB_LENGTH) {
					core.warning(
						`[review] instruction file ${path}: applyTo glob "${glob}" is too complex – ignored`
					);
					return false;
				}
				if ((glob.match(/\*\*/g) ?? []).length <= MAX_GLOBSTARS) return true;
				core.warning(
					`[review] instruction file ${path}: applyTo glob "${glob}" uses more than ${MAX_GLOBSTARS} ** segments – ignored`
				);
				return false;
			});
			if (parsed.declared && globs.length === 0) {
				core.warning(
					`[review] instruction file ${path} has an applyTo with no usable glob – ignored`
				);
				continue;
			}
			const patterns = globs.map(globToRegExp);
			if (!opts.changedPaths.some((p) => patterns.some((g) => g.test(p))))
				continue;
			body = parsed.body;
		}
		body = body.trim();
		if (!body || seen.has(body)) continue;
		const block = `Repository instructions from ${path}:\n${fenced(body, 'markdown')}`;
		if (used + block.length > MAX_TOTAL_CHARS) {
			core.warning(
				`[review] instruction file ${path} exceeds the remaining instruction budget – ignored`
			);
			continue;
		}
		// The quota counts the blocks that actually enter the prompt.
		if (path.startsWith(`${SCOPED_DIR}/`)) {
			if (matchedScoped >= MAX_SCOPED_FILES) {
				core.warning(
					`[review] more than ${MAX_SCOPED_FILES} instruction files match this change; ${path} and later ones are ignored`
				);
				break;
			}
			matchedScoped += 1;
		}
		used += block.length + 2;
		seen.add(body);
		blocks.push(block);
		files.push(path);
	}
	if (files.length > 0)
		core.info(`[review] repository instructions: ${files.join(', ')}`);
	return { text: blocks.join('\n\n'), files };
}
