import type {
	ChangedFile,
	DiffInfo,
	FileChangeStatus,
	PullRequestInfo,
	RepositoryInfo,
	ReviewContext,
} from '../types/context.js';

/**
 * PR context assembly: repository + pull request + diff straight from the
 * GitHub API. Kept transport-agnostic via a minimal structural type so
 * tests can pass plain fakes.
 */

export interface OctokitLike {
	rest: {
		pulls: {
			get(args: unknown): Promise<{ data: PullRequestWire }>;
			listFiles(args: Record<string, unknown>): Promise<{
				data: FileWire[];
			}>;
		};
	};
}

interface PullRequestWire {
	number: number;
	title: string;
	body?: string | null;
	draft?: boolean;
	head: { ref: string; sha: string };
	base: { ref: string; sha: string };
	user?: { login?: string } | null;
}

interface FileWire {
	filename: string;
	status: FileChangeStatus;
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
	previous_filename?: string;
}

export interface FetchPrOptions {
	pageSize?: number;
	maxPages?: number;
}

export async function fetchPrContext(
	octokit: OctokitLike,
	repository: RepositoryInfo,
	prNumber: number,
	options: FetchPrOptions = {}
): Promise<ReviewContext> {
	const pageSize = options.pageSize ?? 100;
	const maxPages = options.maxPages ?? 10;

	const [{ data: pr }, files] = await Promise.all([
		octokit.rest.pulls.get({
			...repository,
			pull_number: prNumber,
		}),
		fetchAllFiles(octokit, repository, prNumber, pageSize, maxPages),
	]);

	const pullRequest: PullRequestInfo = {
		number: pr.number,
		title: pr.title,
		body: pr.body ?? '',
		author: pr.user?.login ?? '',
		headRef: pr.head.ref,
		baseRef: pr.base.ref,
		headSha: pr.head.sha,
		baseSha: pr.base.sha,
		draft: pr.draft ?? false,
	};

	const changedFiles: ChangedFile[] = files.map((f) => ({
		filename: f.filename,
		status: f.status,
		additions: f.additions,
		deletions: f.deletions,
		changes: f.changes,
		patch: f.patch,
		previousFilename: f.previous_filename,
	}));

	const diff: DiffInfo = {
		files: changedFiles,
		totalAdditions: changedFiles.reduce((sum, f) => sum + f.additions, 0),
		totalDeletions: changedFiles.reduce((sum, f) => sum + f.deletions, 0),
		truncated: files.length >= pageSize * maxPages,
	};

	return {
		repository,
		pullRequest,
		diff,
		profiles: [],
		repositoryPath: process.env.GITHUB_WORKSPACE || process.cwd(),
	};
}

async function fetchAllFiles(
	octokit: OctokitLike,
	repository: RepositoryInfo,
	prNumber: number,
	pageSize: number,
	maxPages: number
): Promise<FileWire[]> {
	const all: FileWire[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const { data } = await octokit.rest.pulls.listFiles({
			...repository,
			pull_number: prNumber,
			per_page: pageSize,
			page,
		});
		all.push(...data);
		if (data.length < pageSize) {
			break;
		}
	}
	return all;
}
