import type { Finding } from './finding.js';

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
