import * as github from '@actions/github';
export type OctokitType = ReturnType<typeof github.getOctokit>;
export interface FileData {
    sha: string;
    filename: string;
    status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
    additions: number;
    deletions: number;
    changes: number;
    blob_url: string;
    raw_url: string;
    contents_url: string;
    patch?: string;
    previous_filename?: string;
}
export interface ReviewOptions {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
    reviewEvent: 'COMMENT' | 'REQUEST_CHANGES';
}
export interface ReviewComment {
    path: string;
    line: number;
    startLine: number;
    endLine: number;
    body: string;
    id: string;
}
export interface ContextFile {
    path: string;
    content: string;
    type: 'changed' | 'dependency';
}
export interface ImportContext {
    imports: string[];
    resolvedPaths: string[];
}
