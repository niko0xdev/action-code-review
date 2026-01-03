import OpenAI from 'openai';
import type { ReviewComment } from './reviewParser';
import type { FileData, OctokitType } from './types';
export declare function fetchFileContent(octokit: OctokitType, owner: string, repo: string, sha: string): Promise<string | null>;
export declare function processFile(file: FileData, openai: OpenAI, openaiModel: string, systemPrompt: string, reviewFocus: string, octokit: OctokitType, owner: string, repo: string, includeFullContent: boolean): Promise<{
    comments: ReviewComment[];
    summary: string;
}>;
export declare function filterFiles(files: FileData[], excludePatterns: string, maxFiles: number, includeDir?: string): FileData[];
