import { describe, it, expect, vi } from 'vitest';
import { postCommentsToPR } from '../src/index';
import type { ReviewComment } from '../src/reviewParser';

describe('postCommentsToPR', () => {
        it('sends commit metadata for review comments', async () => {
                const createReview = vi.fn().mockResolvedValue({});
                const octokitMock = {
                        rest: {
                                pulls: {
                                        createReview,
                                        createReviewComment: vi.fn(),
                                },
                                issues: {
                                        createComment: vi.fn(),
                                },
                        },
                } as any;

                const comments: ReviewComment[] = [
                        {
                                path: 'src/file.ts',
                                line: 10,
                                body: 'Inline comment',
                        },
                ];

                await postCommentsToPR(
                        octokitMock,
                        'octo',
                        'hello-world',
                        42,
                        comments,
                        'commit-sha'
                );

                expect(createReview).toHaveBeenCalledWith({
                        owner: 'octo',
                        repo: 'hello-world',
                        pull_number: 42,
                        comments: [
                                {
                                        body: 'Inline comment',
                                        path: 'src/file.ts',
                                        line: 10,
                                        side: 'RIGHT',
                                        commit_id: 'commit-sha',
                                },
                        ],
                        event: 'COMMENT',
                });
        });

        it('falls back to single review comments when batch creation fails', async () => {
                const createReview = vi.fn().mockRejectedValue(new Error('batch failed'));
                const createReviewComment = vi.fn().mockResolvedValue({});
                const createIssueComment = vi.fn().mockResolvedValue({});

                const octokitMock = {
                        rest: {
                                pulls: {
                                        createReview,
                                        createReviewComment,
                                },
                                issues: {
                                        createComment: createIssueComment,
                                },
                        },
                } as any;

                const comments: ReviewComment[] = [
                        { path: 'src/file.ts', line: 5, body: 'First inline comment' },
                        { path: 'src/file.ts', line: 7, body: 'Second inline comment' },
                ];

                await postCommentsToPR(
                        octokitMock,
                        'octo',
                        'hello-world',
                        24,
                        comments,
                        'commit-sha'
                );

                expect(createReviewComment).toHaveBeenCalledTimes(2);
                expect(createReviewComment).toHaveBeenCalledWith({
                        owner: 'octo',
                        repo: 'hello-world',
                        pull_number: 24,
                        body: 'First inline comment',
                        commit_id: 'commit-sha',
                        path: 'src/file.ts',
                        side: 'RIGHT',
                        line: 5,
                });
                expect(createIssueComment).not.toHaveBeenCalled();
        });
});
