import * as core from '@actions/core';
import { redactSecrets } from '../redaction/redactor.js';
import { formatInlineSecurityComment } from './inline-reporter.js';
const STICKY_SUMMARY_MARKER = '<!-- nim-security-sticky-summary -->';
const COMMENT_ID_REGEX = /<!--\s*ai-review-id:\s*([a-zA-Z0-9_-]+)\s*-->/;
/**
 * Publish security findings (inline review comments and sticky summary) to GitHub PR.
 * Spec reference: §16, §17.
 */
export async function publishSecurityReview(octokit, params) {
    const { owner, repo, prNumber, headSha, result } = params;
    // 1. Post or Update Sticky Summary Comment
    if (params.stickyComment !== false && result.summaryMarkdown) {
        try {
            await publishOrUpdateStickyComment(octokit, owner, repo, prNumber, result.summaryMarkdown);
        }
        catch (error) {
            core.warning(`Failed to update sticky security summary comment: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // 2. Publish Inline Review Comments
    if (params.inlineComments !== false && result.findings.length > 0) {
        const existingIds = await fetchExistingSecurityCommentIds(octokit, owner, repo, prNumber);
        const publishableFindings = result.findings.filter((f) => {
            if (!f.file || !f.startLine)
                return false;
            return !existingIds.has(f.fingerprint);
        });
        if (publishableFindings.length > 0) {
            const comments = publishableFindings.map((finding) => ({
                path: finding.file,
                line: finding.startLine,
                side: 'RIGHT',
                body: formatInlineSecurityComment(finding),
            }));
            const hasCriticalOrHigh = publishableFindings.some((f) => f.severity === 'critical' || f.severity === 'high');
            try {
                await octokit.rest.pulls.createReview({
                    owner,
                    repo,
                    pull_number: prNumber,
                    commit_id: headSha,
                    event: hasCriticalOrHigh ? 'REQUEST_CHANGES' : 'COMMENT',
                    comments,
                });
            }
            catch (error) {
                core.warning(`Batch security review failed (${error instanceof Error ? error.message : String(error)}); falling back to individual comments`);
                for (const comment of comments) {
                    try {
                        await octokit.rest.pulls.createReviewComment({
                            owner,
                            repo,
                            pull_number: prNumber,
                            body: comment.body,
                            commit_id: headSha,
                            path: comment.path,
                            line: comment.line,
                            side: comment.side,
                        });
                    }
                    catch (individualError) {
                        core.warning(`Failed to post review comment on ${comment.path}:${comment.line}: ${individualError instanceof Error ? individualError.message : String(individualError)}`);
                    }
                }
            }
        }
    }
}
async function publishOrUpdateStickyComment(octokit, owner, repo, prNumber, bodyMarkdown) {
    if (!octokit.rest.issues.listComments) {
        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: redactSecrets(bodyMarkdown),
        });
        return;
    }
    const comments = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        page: 1,
        per_page: 50,
    });
    const existingSticky = comments.data.find((c) => c.body?.includes(STICKY_SUMMARY_MARKER));
    if (existingSticky && octokit.rest.issues.updateComment) {
        await octokit.rest.issues.updateComment({
            owner,
            repo,
            comment_id: existingSticky.id,
            body: redactSecrets(bodyMarkdown),
        });
    }
    else {
        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: redactSecrets(bodyMarkdown),
        });
    }
}
async function fetchExistingSecurityCommentIds(octokit, owner, repo, prNumber) {
    const ids = new Set();
    if (!octokit.rest.pulls.listReviews ||
        !octokit.rest.pulls.listCommentsForReview) {
        return ids;
    }
    try {
        const reviews = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: prNumber,
            page: 1,
            per_page: 50,
        });
        for (const review of reviews.data) {
            const comments = await octokit.rest.pulls.listCommentsForReview({
                owner,
                repo,
                review_id: review.id,
                page: 1,
                per_page: 100,
            });
            for (const comment of comments.data) {
                if (!comment.body)
                    continue;
                const match = comment.body.match(COMMENT_ID_REGEX);
                if (match?.[1]) {
                    ids.add(match[1]);
                }
            }
        }
    }
    catch {
        // Non-fatal
    }
    return ids;
}
//# sourceMappingURL=security-publisher.js.map