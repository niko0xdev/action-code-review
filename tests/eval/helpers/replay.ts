import {
	type ReviewHarness,
	parseHarnessFindings,
	toReviewResult,
} from '../../../src/harness/harness.js';
import type { ReviewContext } from '../../../src/types/context.js';
import type { ReviewResult } from '../../../src/types/finding.js';
import type { FixtureFile } from './fixtures.js';

export function makeContext(
	files: Array<Required<FixtureFile>>,
	pr: { title?: string; body?: string } = {}
): ReviewContext {
	const additions = files.length;
	return {
		repository: { owner: 'acme', repo: 'widget' },
		pullRequest: {
			number: 7,
			title: pr.title ?? 'Tidy constants',
			body: pr.body ?? '',
			author: 'contributor',
			headRef: 'feature',
			baseRef: 'main',
			headSha: 'sha-head',
			baseSha: 'sha-base',
			draft: false,
		},
		diff: {
			files: files.map((f) => ({
				filename: f.filename,
				status: f.status,
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: f.patch,
			})),
			totalAdditions: additions,
			totalDeletions: 0,
		},
		profiles: [{ id: 'nodejs', evidence: ['package.json'] }],
		repositoryPath: '/repo',
	};
}

/**
 * Offline stand-in for the Pi harness. It replays a canned model reply through
 * the real parser, so refusals, truncated JSON, and hostile output exercise the
 * same code the live run uses. An `Error` simulates a transport failure.
 */
export function stubHarness(
	reply: string | Error,
	options: { filesReviewed?: string[] } = {}
): ReviewHarness {
	return {
		name: 'offline-stub',
		async review(context): Promise<ReviewResult> {
			if (reply instanceof Error) throw reply;
			const parsed = parseHarnessFindings(reply);
			return toReviewResult(
				parsed,
				options.filesReviewed ?? context.diff.files.map((f) => f.filename)
			);
		},
	};
}
