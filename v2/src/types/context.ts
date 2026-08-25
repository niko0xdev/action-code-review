/**
 * Review context types: everything the engine knows about the PR and the
 * repository before the harness runs. See docs/v2-design-spec.md §5/§26.
 */

export interface RepositoryInfo {
	owner: string;
	repo: string;
	/** Default branch name, when known. */
	defaultBranch?: string;
}

export interface PullRequestInfo {
	number: number;
	title: string;
	body: string;
	author: string;
	headRef: string;
	baseRef: string;
	headSha: string;
	baseSha: string;
	draft: boolean;
}

export type FileChangeStatus =
	| 'added'
	| 'removed'
	| 'modified'
	| 'renamed'
	| 'copied'
	| 'changed'
	| 'unchanged';

export interface ChangedFile {
	filename: string;
	status: FileChangeStatus;
	additions: number;
	deletions: number;
	changes: number;
	/** Unified diff patch as returned by GitHub, if available. */
	patch?: string;
	previousFilename?: string;
}

export interface DiffInfo {
	/** Files with a patch attached (text-reviewable). */
	files: ChangedFile[];
	/** Total additions/deletions across all files. */
	totalAdditions: number;
	totalDeletions: number;
	/** True when GitHub truncated the file list (more files than one page). */
	truncated: boolean;
}

export interface DetectedProfile {
	id: ProfileId;
	/** Detection signals that fired, e.g. ["package.json:next dependency"]. */
	evidence: string[];
}

export type ProfileId =
	| 'react'
	| 'nextjs'
	| 'typescript'
	| 'javascript'
	| 'nestjs'
	| 'nodejs'
	| 'python'
	| 'swift'
	| 'kotlin';

export interface ReviewContext {
	repository: RepositoryInfo;
	pullRequest: PullRequestInfo;
	diff: DiffInfo;
	profiles: DetectedProfile[];
	/**
	 * Absolute path to the checked-out repository on the runner.
	 * Harnesses use it as their working directory for inspection.
	 */
	repositoryPath: string;
}
