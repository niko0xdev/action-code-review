import * as core from '@actions/core';
import * as github from '@actions/github';
import OpenAI from 'openai';
import {
	DEFAULT_REVIEW_FOCUS,
	buildUserPrompt,
	createSystemPrompt,
} from './prompts';
import { parseReviewResponse, filterCommentsBySeverity } from './reviewParser';
import type { ReviewComment } from './reviewParser';

interface FileData {
	sha: string;
	filename: string;
	status:
		| 'added'
		| 'removed'
		| 'modified'
		| 'renamed'
		| 'copied'
		| 'changed'
		| 'unchanged';
	additions: number;
	deletions: number;
	changes: number;
	blob_url: string;
	raw_url: string;
	contents_url: string;
	patch?: string;
	previous_filename?: string;
}

type OctokitType = ReturnType<typeof github.getOctokit>;

async function processFile(
	file: FileData,
	openai: OpenAI,
	openaiModel: string,
	systemPrompt: string,
	reviewFocus: string
): Promise<{ comments: ReviewComment[]; summary: string }> {
	if (!file.patch) {
		return { comments: [], summary: '' };
	}

	try {
		// Send to OpenAI for review
		const completion = await openai.chat.completions.create({
			model: openaiModel,
			messages: [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: buildUserPrompt(file.filename, file.patch, reviewFocus),
				},
			],
			max_tokens: 1500,
			temperature: 0.3,
		});

		const reviewText = completion.choices[0]?.message?.content;
		if (!reviewText) {
			return { comments: [], summary: '' };
		}

		// Parse review for line-specific comments
                const parsed = parseReviewResponse(reviewText, file.filename);

                return {
                        comments: parsed.comments,
                        summary: `## ${file.filename}\n\n${parsed.summary}\n\n`,
                };
        } catch (error) {
                core.error(`Error reviewing ${file.filename}: ${error}`);
                return { comments: [], summary: '' };
        }
}

async function run(): Promise<void> {
        try {
		// Get inputs
        const githubToken = core.getInput('github-token', { required: true });
        const openaiApiKey = core.getInput('openai-api-key', { required: true });
        const openaiModel = core.getInput('openai-model') || 'gpt-4';
        const reviewFocus = core.getInput('review-prompt') || DEFAULT_REVIEW_FOCUS;
        const maxFiles = Number.parseInt(core.getInput('max-files') || '10');
        const excludePatterns =
                core.getInput('exclude-patterns') || '*.md,*.txt,*.json,*.yml,*.yaml';
        const autoApproveWhenResolved = core.getBooleanInput('auto-approve-when-resolved');
        const minSeverity = core.getInput('min-severity') || 'info';

		// Initialize clients
		const octokit = github.getOctokit(githubToken)
		core.debug(`OpenAI base URL: ${core.getInput('openai-base-url')}`);
		core.debug(`OpenAI API key: ${openaiApiKey}`);
		core.debug(`OpenAI model: ${openaiModel}`);
                core.debug(`Review focus: ${reviewFocus}`);
                core.debug(`Max files: ${maxFiles}`);
                core.debug(`Exclude patterns: ${excludePatterns}`);
                core.debug(`Auto-approve when resolved: ${autoApproveWhenResolved}`);
                core.debug(`Minimum severity: ${minSeverity}`);

                const openai = new OpenAI({ apiKey: openaiApiKey, baseURL: core.getInput('openai-base-url') })

		// Get PR context
		const context = github.context;
		if (!context.payload.pull_request) {
			core.setFailed('This action only runs on pull requests');
			return;
		}

                const pullRequest = context.payload.pull_request;
                const owner = context.repo.owner;
                const repo = context.repo.repo;
                const prNumber = pullRequest.number;
                const headSha = pullRequest.head?.sha || context.sha;

                core.info(`Processing PR #${prNumber} in ${owner}/${repo}`);

		// Get PR diff
		const { data: files } = await octokit.rest.pulls.listFiles({
			owner,
			repo,
			pull_number: prNumber,
		});

		// Filter files
		const excludeList = excludePatterns.split(',').map((p) => p.trim());
		const filteredFiles = files
			.filter((file) => {
				return !excludeList.some((pattern) => {
					const regex = new RegExp(pattern.replace(/\*/g, '.*'));
					return regex.test(file.filename);
				});
			})
			.slice(0, maxFiles);

		if (filteredFiles.length === 0) {
			core.info('No files to review after filtering');
			return;
		}

		core.info(`Reviewing ${filteredFiles.length} files`);

		// Process each file
		const systemPrompt = createSystemPrompt();
		const allComments: ReviewComment[] = [];
		let reviewSummary = '';

		for (const file of filteredFiles) {
			core.info(`Reviewing file: ${file.filename}`);

			const { comments, summary } = await processFile(
				file,
				openai,
				openaiModel,
				systemPrompt,
				reviewFocus
			);

			allComments.push(...comments);
			reviewSummary += summary;
		}

		// Filter comments by minimum severity level
		const filteredComments = filterCommentsBySeverity(allComments, minSeverity);
		core.info(`Filtered ${allComments.length} comments to ${filteredComments.length} based on minimum severity: ${minSeverity}`);

                // Post comments to PR
                if (filteredComments.length > 0) {
                        await postCommentsToPR(
                                octokit,
                                owner,
                                repo,
                                prNumber,
                                filteredComments,
                                headSha
                        );
                        core.info(`Posted ${filteredComments.length} comments to PR`);
                }

		// Post review summary
		if (reviewSummary) {
			await octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: prNumber,
				body: `# 🤖 AI Code Review\n\n${reviewSummary}`,
			});
			core.info('Posted review summary to PR');
		}

                // Set output
                core.setOutput('review-summary', reviewSummary);

                if (autoApproveWhenResolved) {
                        const botLogin = await getAuthenticatedLogin(octokit);
                        if (!botLogin) {
                                core.info('Unable to determine authenticated user; skipping approval.');
                                return;
                        }

                        const aiCommentsResolved = await areAiCommentsResolved(
                                octokit,
                                owner,
                                repo,
                                prNumber,
                                botLogin
                        );

                        if (aiCommentsResolved) {
                                await approvePullRequest(octokit, owner, repo, prNumber);
                        } else {
                                core.info('AI review comments are still unresolved; not approving.');
                        }
                }
        } catch (error) {
                core.setFailed(`Action failed: ${error}`);
        }
}

async function postCommentsToPR(
        octokit: OctokitType,
        owner: string,
        repo: string,
        prNumber: number,
        comments: ReviewComment[],
        commitId: string
): Promise<void> {
        // Group comments by file to avoid rate limiting
        const commentsByFile = comments.reduce(
                (acc, comment) => {
			if (!acc[comment.path]) {
				acc[comment.path] = [];
			}
			acc[comment.path].push(comment);
			return acc;
		},
		{} as Record<string, ReviewComment[]>
	);

        // Post comments for each file
        for (const [filename, fileComments] of Object.entries(commentsByFile)) {
                const reviewComments = fileComments.map((comment) => ({
                        body: appendCommentId(comment),
                        path: comment.path,
                        line: comment.line ?? 1,
                        side: 'RIGHT' as const,
                        commit_id: commitId,
                }));

                try {
                        // Create a review comment for each file
                        await octokit.rest.pulls.createReview({
                                owner,
                                repo,
                                pull_number: prNumber,
                                comments: reviewComments,
                                event: 'COMMENT',
                        });
                } catch (error) {
                        core.error(`Failed to post comments for ${filename}: ${error}`);

                        for (const reviewComment of reviewComments) {
                                try {
                                        await octokit.rest.pulls.createReviewComment({
                                                owner,
                                                repo,
                                                pull_number: prNumber,
                                                body: reviewComment.body,
                                                commit_id: reviewComment.commit_id,
                                                path: reviewComment.path,
                                                side: reviewComment.side,
                                                line: reviewComment.line,
                                        });
                                } catch (commentError) {
                                        core.error(
                                                `Failed to post individual comment for ${filename}: ${commentError}`
                                        );

                                        // Fallback: create a regular issue comment
                                        await octokit.rest.issues.createComment({
                                                owner,
                                                repo,
                                                issue_number: prNumber,
                                                body: `## 📝 Review for ${filename}\n\n**Line ${reviewComment.line}:** ${reviewComment.body}`,
                                        });
                                }
                        }
                }
        }
}

function appendCommentId(comment: ReviewComment): string {
        const marker = `<!-- ai-review-id:${comment.id} -->`;

        if (comment.body.includes('<!-- ai-review-id:')) {
                return comment.body;
        }

        return `${comment.body}\n\n${marker}`.trim();
}

async function getAuthenticatedLogin(octokit: OctokitType): Promise<string | null> {
        try {
                        const { data } = await octokit.rest.users.getAuthenticated();
                        return data.login;
        } catch (error) {
                        core.error(`Failed to fetch authenticated user: ${error}`);
                        return null;
        }
}

async function areAiCommentsResolved(
        octokit: OctokitType,
        owner: string,
        repo: string,
        prNumber: number,
        aiLogin: string
): Promise<boolean> {
        try {
                const threads = await octokit.paginate(
                        'GET /repos/{owner}/{repo}/pulls/{pull_number}/threads',
                        {
                        owner,
                        repo,
                        pull_number: prNumber,
                        }
                );

                const aiThreads = threads.filter((thread: any) =>
                        thread.comments?.some((comment: any) => comment.user?.login === aiLogin)
                );

                if (aiThreads.length === 0) {
                        core.info('No AI-generated review threads found; skipping approval.');
                        return false;
                }

                const unresolvedThreads = aiThreads.filter((thread: any) => !thread.resolved);
                const allResolved = unresolvedThreads.length === 0;

                if (!allResolved) {
                        core.info(`Found ${unresolvedThreads.length} unresolved AI review threads.`);
                }

                return allResolved;
        } catch (error) {
                core.error(`Failed to check review thread resolution status: ${error}`);
                return false;
        }
}

async function approvePullRequest(
        octokit: OctokitType,
        owner: string,
        repo: string,
        prNumber: number
): Promise<void> {
        try {
                await octokit.rest.pulls.createReview({
                        owner,
                        repo,
                        pull_number: prNumber,
                        event: 'APPROVE',
                        body: 'All AI-generated review comments have been resolved. Auto-approving the PR.',
                });
                core.info('Submitted approval review because AI comments are resolved.');
        } catch (error) {
                core.error(`Failed to submit approval review: ${error}`);
        }
}

// Run the action
if (require.main === module) {
	run();
}

// Helper re-exports for compatibility
export { parseReviewForComments, parseReviewResponse } from './reviewParser';
export { postCommentsToPR };
