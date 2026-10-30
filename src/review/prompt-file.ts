import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import * as core from '@actions/core';

const run = promisify(execFile);
const MAX_BYTES = 50 * 1024;

/** Metadata and content of a file at the base SHA, as the contents API returns it. */
export interface BaseFileData {
	type: string;
	size: number;
	content?: string;
	encoding?: string;
}

export interface PromptFileOptions {
	/** Workspace root (the PR head checkout). */
	repoPath: string;
	/** Value of the `review-prompt-file` input. */
	file: string;
	/** Pull request base SHA; unset outside pull_request events. */
	baseSha?: string;
	/** Paths the pull request changes (including rename sources). */
	changedPaths: ReadonlySet<string>;
	/** True when the changed-file list hit the listing cap and is incomplete. */
	filesTruncated?: boolean;
	/**
	 * Fetch `rel` at the base SHA from the hosting API when the base object is
	 * missing locally (shallow checkout). Resolves `undefined` when the path does
	 * not exist at base, throws when the API is unavailable.
	 */
	fetchBase?: (
		rel: string,
		baseSha: string
	) => Promise<BaseFileData | BaseFileData[] | undefined>;
}

function warn(file: string, why: string): undefined {
	core.warning(`[review] review-prompt-file ${file} ${why} – ignored`);
	return undefined;
}

/**
 * Outcome of looking for the file at the base SHA.
 * - `content`: trusted base copy.
 * - `ignore`: an entry exists at base but is not a usable regular file.
 * - `absent`: the path does not exist at base.
 * - `unavailable`: the base object cannot be read locally.
 */
type BaseResult =
	| { kind: 'content'; text: string }
	| { kind: 'ignore'; why: string }
	| { kind: 'absent' }
	| { kind: 'unavailable' };

async function readFromGit(
	repoPath: string,
	baseSha: string,
	rel: string
): Promise<BaseResult> {
	const git = (args: string[], maxBuffer: number) =>
		run('git', ['-C', repoPath, ...args], {
			env: { PATH: process.env.PATH, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
			maxBuffer,
			timeout: 10_000,
		});
	let listing: string;
	try {
		listing = (await git(['ls-tree', baseSha, '--', rel], 4096)).stdout;
	} catch {
		return { kind: 'unavailable' };
	}
	if (!listing.trim()) return { kind: 'absent' };
	// Only regular blobs: a symlink blob would yield its target path as text.
	if (!/^100(644|755) blob /.test(listing)) {
		return { kind: 'ignore', why: 'is not a regular file at the base ref' };
	}
	try {
		const blob = await git(
			['cat-file', 'blob', `${baseSha}:${rel}`],
			MAX_BYTES
		);
		return { kind: 'content', text: blob.stdout };
	} catch (error) {
		const code = (error as { code?: string }).code;
		return code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
			? { kind: 'ignore', why: 'exceeds 50 KiB at the base ref' }
			: { kind: 'unavailable' };
	}
}

async function readFromApi(
	fetchBase: NonNullable<PromptFileOptions['fetchBase']>,
	baseSha: string,
	rel: string
): Promise<BaseResult> {
	let data: Awaited<ReturnType<typeof fetchBase>>;
	try {
		data = await fetchBase(rel, baseSha);
	} catch {
		return { kind: 'unavailable' };
	}
	if (!data) return { kind: 'absent' };
	if (Array.isArray(data) || data.type !== 'file') {
		return { kind: 'ignore', why: 'is not a regular file at the base ref' };
	}
	if (data.size > MAX_BYTES) {
		return { kind: 'ignore', why: 'exceeds 50 KiB at the base ref' };
	}
	if (data.encoding !== 'base64' || typeof data.content !== 'string') {
		return { kind: 'unavailable' };
	}
	return {
		kind: 'content',
		text: Buffer.from(data.content, 'base64').toString('utf8'),
	};
}

/** `a/b/c.md` -> [`a`, `a/b`, `a/b/c.md`]. */
function withAncestors(posixPath: string): string[] {
	const parts = posixPath.split('/');
	return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** True when any path component between root and `rel` is a symlink. */
async function hasSymlinkComponent(
	root: string,
	rel: string
): Promise<boolean> {
	let current = root;
	for (const part of rel.split(sep)) {
		current = resolve(current, part);
		if ((await lstat(current)).isSymbolicLink()) return true;
	}
	return false;
}

/**
 * Load `review-prompt-file` for the trusted rules slot. The file is
 * PR-controlled, so the base-branch copy wins: a PR cannot steer the reviewer by
 * editing it. A base entry that exists but is not a regular blob, or is too
 * large, means the file is ignored. Only when no base copy can be obtained (the
 * path is new, or the base object cannot be read) is the checkout copy used, and
 * only if the changed-file list is complete, nothing on the path is a symlink,
 * and neither the path nor any ancestor is touched by the PR (compared
 * case-insensitively). Only regular files up to 50 KiB are read.
 */
export async function loadReviewPromptFile(
	opts: PromptFileOptions
): Promise<string | undefined> {
	const { repoPath, file, baseSha, changedPaths, filesTruncated } = opts;
	if (!file) return undefined;
	if (file.includes('\0')) return warn(file, 'contains null byte');
	if (isAbsolute(file)) return warn(file, 'must be repo-relative');
	const rel = relative(repoPath, resolve(repoPath, file));
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
		return warn(file, 'escapes repository');
	}
	const posixRel = rel.split(sep).join('/');
	try {
		if (baseSha && /^[0-9a-f]{40,64}$/i.test(baseSha)) {
			let base = await readFromGit(repoPath, baseSha, posixRel);
			if (base.kind === 'unavailable' && opts.fetchBase) {
				base = await readFromApi(opts.fetchBase, baseSha, posixRel);
			}
			if (base.kind === 'content') return base.text.trim() || undefined;
			if (base.kind === 'ignore') return warn(file, base.why);
		}
		if (filesTruncated) {
			return warn(
				file,
				'has no base copy and the changed-file list is truncated'
			);
		}
		const full = resolve(repoPath, file);
		if (await hasSymlinkComponent(repoPath, rel)) {
			return warn(file, 'passes through a symlink and has no base copy');
		}
		const [root, real] = await Promise.all([
			realpath(repoPath),
			realpath(full),
		]);
		const inside = relative(root, real);
		if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
			return warn(file, 'escapes repository');
		}
		const touched = new Set(
			[...changedPaths].flatMap((p) => [p, p.toLowerCase()])
		);
		const candidates = [
			...withAncestors(posixRel),
			...withAncestors(inside.split(sep).join('/')),
		];
		if (
			candidates.some((p) => touched.has(p) || touched.has(p.toLowerCase()))
		) {
			return warn(
				file,
				'is modified by this pull request and has no base copy'
			);
		}
		// Open the resolved path once and inspect the handle, not the path.
		const handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const info = await handle.stat();
			if (!info.isFile()) return warn(file, 'is not a regular file');
			if (info.size > MAX_BYTES) return warn(file, 'exceeds 50 KiB');
			return (await handle.readFile('utf8')).trim() || undefined;
		} finally {
			await handle.close();
		}
	} catch (error) {
		core.warning(
			`[review] review-prompt-file read failed: ${error instanceof Error ? error.message : String(error)}`
		);
		return undefined;
	}
}
