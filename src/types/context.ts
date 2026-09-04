/**
 * Review context types: everything the engine knows about the PR and the
 * repository before the harness runs. See docs/design-spec.md §5/§26.
 */

export interface RepositoryInfo {
	owner: string;
	repo: string;
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
	| 'kotlin'
	| 'postgres'
	| 'mysql';

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
