import { type Mock, vi } from 'vitest';
export { makeContext, stubHarness } from './replay.js';

export interface RecordingOctokit {
	rest: {
		pulls: {
			get: Mock<any[], any>;
			createReview: Mock<any[], any>;
			listThreads: Mock<any[], any>;
		};
		issues: {
			createComment: Mock<any[], any>;
			listComments: Mock<any[], any>;
		};
	};
	users: { getAuthenticated: Mock<any[], any> };
	paginate: Mock<any[], any>;
}

/**
 * GitHub client double that records everything the publisher would send.
 * `currentHeadSha` is what the head recheck sees. When `resolvedAiThread` is
 * set, a resolved AI thread exists, so an auto-approval is possible whenever
 * the publisher believes the review is clean.
 */
export function recordingOctokit(
	options: { currentHeadSha?: string; resolvedAiThread?: boolean } = {}
): RecordingOctokit {
	const threads = options.resolvedAiThread
		? [
				{
					resolved: true,
					comments: [
						{
							user: { login: 'bot' },
							body: '<!-- ai-review-id:aaaaaaaaaaaa -->',
						},
					],
				},
			]
		: [];
	return {
		rest: {
			pulls: {
				get: vi.fn(async () => ({
					data: { head: { sha: options.currentHeadSha ?? 'sha-head' } },
				})),
				createReview: vi.fn(async () => ({ data: {} })),
				listThreads: vi.fn(async () => threads),
			},
			issues: {
				createComment: vi.fn(async () => ({ data: {} })),
				listComments: vi.fn(async () => ({ data: [] })),
			},
		},
		users: {
			getAuthenticated: vi.fn(async () => ({ data: { login: 'bot' } })),
		},
		paginate: vi.fn(async () => []),
	};
}

/** Every string the publisher handed to GitHub write endpoints. */
export function outboundPayloads(octokit: RecordingOctokit): string {
	return JSON.stringify([
		octokit.rest.pulls.createReview.mock.calls,
		octokit.rest.issues.createComment.mock.calls,
	]);
}

/** Events passed to `createReview`, in order. */
export function reviewEvents(octokit: RecordingOctokit): string[] {
	return octokit.rest.pulls.createReview.mock.calls.map(
		(call) => (call[0] as { event: string }).event
	);
}

/** Summary comment bodies posted via `issues.createComment`. */
export function commentBodies(octokit: RecordingOctokit): string[] {
	return octokit.rest.issues.createComment.mock.calls.map(
		(call) => (call[0] as { body: string }).body
	);
}

// --- Markdown fence parsing --------------------------------------------------

export interface FenceReport {
	/** True when a fence is still open after the last line. */
	unterminated: boolean;
	/** Zero-based indexes of lines that sit inside an open fence. */
	insideLines: Set<number>;
}

/**
 * Minimal CommonMark fenced-code scanner: an opening fence is a line starting
 * with three or more backticks; it closes on a line of at least as many
 * backticks and nothing else. Matches how a renderer (or a model) reads the
 * prompt, which is the property that matters for containment.
 */
export function scanFences(text: string): FenceReport {
	const insideLines = new Set<number>();
	let open: number | null = null;
	for (const [index, line] of text.split('\n').entries()) {
		if (open === null) {
			const opening = /^ {0,3}(`{3,})[^`]*$/.exec(line);
			if (opening) open = opening[1].length;
			continue;
		}
		const closing = /^ {0,3}(`{3,})\s*$/.exec(line);
		if (closing && closing[1].length >= open) {
			open = null;
			continue;
		}
		insideLines.add(index);
	}
	return { unterminated: open !== null, insideLines };
}
