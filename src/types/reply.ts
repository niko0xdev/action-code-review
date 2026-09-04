import type { Finding } from './finding.js';

/**
 * Inline reply shape (spec §20 extension): a follow-up posted under an
 * existing review comment thread. `commentId` is GitHub's numeric review
 * comment id — never the ai-review-id marker, which stays embedded in the
 * body for dedupe continuity.
 */

export interface ReviewReply {
	/** GitHub's numeric review comment id to reply beneath. */
	commentId: number;
	/** Follow-up text. Empty bodies are rejected before any API call. */
	body: string;
	/** Optional finding context; supplies the ai-review-id marker. */
	finding?: Finding;
}

export interface ReplyParams {
	owner: string;
	repo: string;
	prNumber: number;
	commentId: number;
	body: string;
	finding?: Finding;
}

export interface ReplyResult {
	id: number;
	html_url: string;
}
