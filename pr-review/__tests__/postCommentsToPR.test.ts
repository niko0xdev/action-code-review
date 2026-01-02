import { describe, it, expect, vi } from 'vitest';
import { postCommentsToPR } from '../src/index';
import type { ReviewComment } from '../src/reviewParser';

describe('postCommentsToPR', () => {
        it('sends commit metadata for review comments', async () => {
                const createReview = vi.fn().mockResolvedValue({});
                const listReviews = vi.fn().mockResolvedValue({ data: [] });
                const octokitMock = {
                        rest: {
                                pulls: {
                                        createReview,
                                        createReviewComment: vi.fn(),
                                        listReviews,
                                },
                                issues: {
                                        createComment: vi.fn(),
                                },
                                users: {
                                        getAuthenticated: vi.fn().mockResolvedValue({
                                                data: { login: 'bot' },
                                        }),
                                },
                        },
                } as any;

                const comments: ReviewComment[] = [
                        {
                                path: 'src/file.ts',
                                line: 10,
                                body: 'Inline comment',
                                id: 'comment-id-1',
                        },
                ];

                await postCommentsToPR(
                        octokitMock,
                        'octo',
                        'hello-world',
                        42,
                        comments,
                        'commit-sha',
                        'COMMENT'
                );

                expect(createReview).toHaveBeenCalledWith({
                        owner: 'octo',
                        repo: 'hello-world',
                        pull_number: 42,
                        comments: [
                                {
                                        body: 'Inline comment\n\n<!-- ai-review-id:comment-id-1 -->',
                                        path: 'src/file.ts',
                                        line: 10,
                                        side: 'RIGHT',
                                        commit_id: 'commit-sha',
                                },
                        ],
                        event: 'COMMENT',
                });
        });

        it('sends REQUEST_CHANGES event when specified', async () => {
                const createReview = vi.fn().mockResolvedValue({});
                const listReviews = vi.fn().mockResolvedValue({ data: [] });
                const octokitMock = {
                        rest: {
                                pulls: {
                                        createReview,
                                        createReviewComment: vi.fn(),
                                        listReviews,
                                },
                                issues: {
                                        createComment: vi.fn(),
                                },
                                users: {
                                        getAuthenticated: vi.fn().mockResolvedValue({
                                                data: { login: 'bot' },
                                        }),
                                },
                        },
                } as any;

                const comments: ReviewComment[] = [
                        {
                                path: 'src/file.ts',
                                line: 10,
                                body: 'Critical issue',
                                id: 'comment-id-1',
                        },
                ];

                await postCommentsToPR(
                        octokitMock,
                        'octo',
                        'hello-world',
                        42,
                        comments,
                        'commit-sha',
                        'REQUEST_CHANGES'
                );

                expect(createReview).toHaveBeenCalledWith({
                        owner: 'octo',
                        repo: 'hello-world',
                        pull_number: 42,
                        comments: [
                                {
                                        body: 'Critical issue\n\n<!-- ai-review-id:comment-id-1 -->',
                                        path: 'src/file.ts',
                                        line: 10,
                                        side: 'RIGHT',
                                        commit_id: 'commit-sha',
                                },
                        ],
                        event: 'REQUEST_CHANGES',
                });
        });

        it('falls back to single review comments when batch creation fails', async () => {
                const createReview = vi.fn().mockRejectedValue(new Error('batch failed'));
                const createReviewComment = vi.fn().mockResolvedValue({});
                const createIssueComment = vi.fn().mockResolvedValue({});
                const listReviews = vi.fn().mockResolvedValue({ data: [] });
                const getAuthenticated = vi.fn().mockResolvedValue({
                        data: { login: 'bot' },
                });

                const octokitMock = {
                        rest: {
                                pulls: {
                                        createReview,
                                        createReviewComment,
                                        listReviews,
                                },
                                issues: {
                                        createComment: createIssueComment,
                                },
                                users: {
                                        getAuthenticated,
                                },
                        },
                } as any;

                const comments: ReviewComment[] = [
                        {
                                path: 'src/file.ts',
                                line: 5,
                                body: 'First inline comment',
                                id: 'comment-id-2',
                        },
                        {
                                path: 'src/file.ts',
                                line: 7,
                                body: 'Second inline comment',
                                id: 'comment-id-3',
                        },
                ];

                await postCommentsToPR(
                        octokitMock,
                        'octo',
                        'hello-world',
                        24,
                        comments,
                        'commit-sha',
                        'COMMENT'
                );

                expect(createReviewComment).toHaveBeenCalledTimes(2);
                expect(createReviewComment).toHaveBeenCalledWith({
                        owner: 'octo',
                        repo: 'hello-world',
                        pull_number: 24,
                        body: 'First inline comment\n\n<!-- ai-review-id:comment-id-2 -->',
                        commit_id: 'commit-sha',
                        path: 'src/file.ts',
                        side: 'RIGHT',
                        line: 5,
                });
                expect(createIssueComment).not.toHaveBeenCalled();
        });

        it('skips duplicate comments when they already exist', async () => {
                const createReview = vi.fn().mockResolvedValue({});
                const listReviews = vi.fn().mockResolvedValue({
                        data: [
                                {
                                        id: 1,
                                        user: { login: 'bot' },
                                },
                        ],
                });
                const listCommentsForReview = vi.fn().mockResolvedValue({
                        data: [
                                {
                                        body: 'Duplicate comment\n\n<!-- ai-review-id:abc123def456 -->',
                                },
                        ],
                });

                const octokitMock = {
                        rest: {
                                pulls: {
                                        createReview,
                                        createReviewComment: vi.fn(),
                                        listReviews,
                                        listCommentsForReview,
                                },
                                issues: {
                                        createComment: vi.fn(),
                                },
                                users: {
                                        getAuthenticated: vi.fn().mockResolvedValue({
                                                data: { login: 'bot' },
                                        }),
                                },
                        },
                } as any;

                const comments: ReviewComment[] = [
                        {
                                path: 'src/file.ts',
                                line: 10,
                                body: 'Duplicate comment',
                                id: 'abc123def456',
                        },
                ];

                await postCommentsToPR(
                        octokitMock,
                        'octo',
                        'hello-world',
                        42,
                        comments,
                        'commit-sha',
                        'COMMENT'
                );

                expect(createReview).not.toHaveBeenCalled();
        });
});
