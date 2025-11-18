import * as core from '@actions/core';
import * as github from '@actions/github';
import OpenAI from 'openai';
import { DEFAULT_REVIEW_FOCUS, buildUserPrompt, createSystemPrompt } from './prompts';
import { parseReviewResponse } from './reviewParser';
import type { ReviewComment } from './reviewParser';

async function run(): Promise<void> {
  try {
    // Get inputs
    const githubToken = core.getInput('github-token', { required: true });
    const openaiApiKey = core.getInput('openai-api-key', { required: true });
    const openaiModel = core.getInput('openai-model') || 'gpt-4';
    const reviewFocus = core.getInput('review-prompt') || DEFAULT_REVIEW_FOCUS;
    const maxFiles = parseInt(core.getInput('max-files') || '10');
    const excludePatterns = core.getInput('exclude-patterns') || '*.md,*.txt,*.json,*.yml,*.yaml';

    // Initialize clients
    const octokit = github.getOctokit(githubToken);
    const openai = new OpenAI({ apiKey: openaiApiKey });

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

    core.info(`Processing PR #${prNumber} in ${owner}/${repo}`);

    // Get PR diff
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Filter files
    const excludeList = excludePatterns.split(',').map(p => p.trim());
    const filteredFiles = files.filter(file => {
      return !excludeList.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(file.filename);
      });
    }).slice(0, maxFiles);

    if (filteredFiles.length === 0) {
      core.info('No files to review after filtering');
      return;
    }

    core.info(`Reviewing ${filteredFiles.length} files`);

    // Process each file
    const allComments: ReviewComment[] = [];
    let reviewSummary = '';

    const systemPrompt = createSystemPrompt();

    for (const file of filteredFiles) {
      core.info(`Reviewing file: ${file.filename}`);
      
      if (!file.patch) {
        core.info(`No diff available for ${file.filename}`);
        continue;
      }

      try {
        // Send to OpenAI for review
        const completion = await openai.chat.completions.create({
          model: openaiModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: buildUserPrompt(file.filename, file.patch, reviewFocus)
            }
          ],
          max_tokens: 1500,
          temperature: 0.3,
        });

        const reviewText = completion.choices[0]?.message?.content;
        if (!reviewText) {
          core.warning(`No review content received for ${file.filename}`);
          continue;
        }

        const parsedReview = parseReviewResponse(reviewText, file.filename);
        allComments.push(...parsedReview.comments);
        reviewSummary += `## ${file.filename}\n\n${parsedReview.summary}\n\n`;

      } catch (error) {
        core.error(`Error reviewing ${file.filename}: ${error}`);
      }
    }

    // Post comments to PR
    if (allComments.length > 0) {
      await postCommentsToPR(octokit, owner, repo, prNumber, allComments);
      core.info(`Posted ${allComments.length} comments to PR`);
    }

    // Post review summary
    if (reviewSummary) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `# 🤖 AI Code Review\n\n${reviewSummary}`
      });
      core.info('Posted review summary to PR');
    }

    // Set output
    core.setOutput('review-summary', reviewSummary);

  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
  }
}

async function postCommentsToPR(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number,
  comments: ReviewComment[]
): Promise<void> {
  // Group comments by file to avoid rate limiting
  const commentsByFile = comments.reduce((acc, comment) => {
    if (!acc[comment.path]) {
      acc[comment.path] = [];
    }
    acc[comment.path].push(comment);
    return acc;
  }, {} as Record<string, ReviewComment[]>);

  // Post comments for each file
  for (const [filename, fileComments] of Object.entries(commentsByFile)) {
    try {
      // Create a review comment for each file
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        comments: fileComments,
        event: 'COMMENT'
      });
    } catch (error) {
      core.error(`Failed to post comments for ${filename}: ${error}`);
      
      // Fallback: create a regular issue comment
      const commentBody = fileComments
        .map(c => `**Line ${c.line}:** ${c.body}`)
        .join('\n\n');
      
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `## 📝 Review for ${filename}\n\n${commentBody}`
      });
    }
  }
}

// Run the action
if (require.main === module) {
  run();
}

// Helper re-exports for compatibility
export { parseReviewForComments, parseReviewResponse } from './reviewParser';
