import type * as github from '@actions/github';

export type OctokitType = ReturnType<typeof github.getOctokit>;

export interface CommentContext {
	/** The parent AI review comment that started the thread */
	parentComment: {
		id: number;
		body: string;
		userLogin: string;
		aiReviewId: string | null;
	};
	/** The developer's question/comment */
	questionComment: {
		id: number;
		body: string;
		userLogin: string;
		createdAt: string;
	};
	/** File context if available */
	fileContext?: {
		path: string;
		line: number | null;
		content?: string;
	};
	/** PR context */
	prContext: {
		number: number;
		title: string;
		owner: string;
		repo: string;
		headSha: string;
	};
}

export interface ReplyOptions {
	owner: string;
	repo: string;
	prNumber: number;
	parentCommentId: number;
}

export interface AIReply {
	/** The generated response text */
	body: string;
	/** Whether to use specific formatting */
	useMarkdown: boolean;
}

export interface QuestionDetectionConfig {
	/** Whether to enable question detection */
	enabled: boolean;
	/** Additional keywords to treat as questions */
	keywords: string[];
}

export interface ContextOptions {
	/** Include full file content in context */
	includeFullContent: boolean;
	/** Maximum context length in characters */
	maxContextChars: number;
}
