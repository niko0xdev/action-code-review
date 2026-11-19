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

/**
 * Glob as used by `applyTo`: `**` spans directories, `*` and `?` stay inside
 * one path segment, everything else is literal. Built from escaped literals
 * and bounded classes, so matching stays linear.
 */
export function globToRegExp(glob: string): RegExp {
	let out = '';
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		if (char === '*' && glob[i + 1] === '*') {
			const slash = glob[i + 2] === '/';
			out += slash ? '(?:.*/)?' : '.*';
			i += slash ? 2 : 1;
		} else if (char === '*') out += '[^/]*';
		else if (char === '?') out += '[^/]';
		else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${out}$`);
}

/** Split `---` front matter from the body and read its `applyTo` globs. */
function parseScoped(text: string): { body: string; applyTo?: string[] } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	if (!match) return { body: text };
	const line = /^applyTo:[ \t]*(.*)$/m.exec(match[1]);
	const value = line?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
	return {
		body: text.slice(match[0].length),
		applyTo: value
			?.split(',')
			.map((glob) => glob.trim())
			.filter(Boolean),
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
	const scoped = (await listScoped(opts, baseSha))
		.slice(0, MAX_SCOPED_FILES)
		.map((name) => `${SCOPED_DIR}/${name}`);
	const blocks: string[] = [];
	const files: string[] = [];
	let used = 0;
	for (const path of [...FIXED_FILES, ...scoped]) {
		const base = await readBase(opts, baseSha, path);
		if (base.kind === 'ignore') {
			core.warning(`[review] instruction file ${path} ${base.why} – ignored`);
			continue;
		}
		if (base.kind !== 'content') continue;
		let body = base.text;
		if (path.startsWith(`${SCOPED_DIR}/`)) {
			const parsed = parseScoped(body);
			const globs = (parsed.applyTo ?? []).map(globToRegExp);
			if (!opts.changedPaths.some((p) => globs.some((g) => g.test(p))))
				continue;
			body = parsed.body;
		}
		body = body.trim();
		if (!body) continue;
		const block = `Repository instructions from ${path}:\n${fenced(body, 'markdown')}`;
		if (used + block.length > MAX_TOTAL_CHARS) {
			core.warning(
				`[review] instruction file ${path} exceeds the remaining instruction budget – ignored`
			);
			continue;
		}
		used += block.length + 2;
		blocks.push(block);
		files.push(path);
	}
	if (files.length > 0)
		core.info(`[review] repository instructions: ${files.join(', ')}`);
	return { text: blocks.join('\n\n'), files };
}
