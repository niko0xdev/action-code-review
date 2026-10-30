import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import * as core from '@actions/core';

const run = promisify(execFile);
const MAX_BYTES = 50 * 1024;

export interface PromptFileOptions {
	/** Workspace root (the PR head checkout). */
	repoPath: string;
	/** Value of the `review-prompt-file` input. */
	file: string;
	/** Pull request base SHA; unset outside pull_request events. */
	baseSha?: string;
	/** Paths the pull request changes (including rename sources). */
	changedPaths: ReadonlySet<string>;
}

function warn(file: string, why: string): undefined {
	core.warning(`[review] review-prompt-file ${file} ${why} – ignored`);
	return undefined;
}

/** Regular-file blob content at `<baseSha>:<rel>`, or undefined if unavailable. */
async function readFromBase(
	repoPath: string,
	baseSha: string,
	rel: string
): Promise<string | undefined> {
	const git = (args: string[], maxBuffer: number) =>
		run('git', ['-C', repoPath, ...args], {
			env: { PATH: process.env.PATH, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
			maxBuffer,
			timeout: 10_000,
		});
	try {
		const tree = await git(['ls-tree', baseSha, '--', rel], 4096);
		// Only regular blobs: a symlink blob would yield its target path as text.
		if (!/^100(644|755) blob /.test(tree.stdout)) return undefined;
		const blob = await git(
			['cat-file', 'blob', `${baseSha}:${rel}`],
			MAX_BYTES
		);
		return blob.stdout;
	} catch {
		return undefined;
	}
}

/**
 * Load `review-prompt-file` for the trusted rules slot. The file is
 * PR-controlled, so the base-branch copy wins: a PR cannot steer the reviewer by
 * editing it. When the base copy is unavailable the head copy is read only if
 * the PR leaves that path untouched. Symlinks are resolved and must stay inside
 * the workspace, and only regular files up to 50 KiB are read.
 */
export async function loadReviewPromptFile(
	opts: PromptFileOptions
): Promise<string | undefined> {
	const { repoPath, file, baseSha, changedPaths } = opts;
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
			const content = await readFromBase(repoPath, baseSha, posixRel);
			if (content !== undefined) return content.trim() || undefined;
			if (changedPaths.has(posixRel)) {
				return warn(
					file,
					'is modified by this pull request and has no base copy'
				);
			}
		}
		const [root, real] = await Promise.all([
			realpath(repoPath),
			realpath(resolve(repoPath, file)),
		]);
		const inside = relative(root, real);
		if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
			return warn(file, 'escapes repository');
		}
		const info = await stat(real);
		if (!info.isFile()) return warn(file, 'is not a regular file');
		if (info.size > MAX_BYTES) return warn(file, 'exceeds 50 KiB');
		return (await readFile(real, 'utf8')).trim() || undefined;
	} catch (error) {
		core.warning(
			`[review] review-prompt-file read failed: ${error instanceof Error ? error.message : String(error)}`
		);
		return undefined;
	}
}
