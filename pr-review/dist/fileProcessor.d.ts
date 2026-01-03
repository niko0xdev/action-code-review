import OpenAI from 'openai';
import type { ReviewComment } from './reviewParser';
import type { FileData, OctokitType, ContextFile } from './types';
export declare function fetchFileContent(octokit: OctokitType, owner: string, repo: string, sha: string): Promise<string | null>;
/**
 * Build context files list with smart import-based selection
 */
export declare function buildContextFiles(changedFiles: FileData[], knownFiles: string[], octokit: OctokitType, owner: string, repo: string, includeFullContent: boolean, maxContextChars: number): Promise<ContextFile[]>;
export declare function processFile(file: FileData, openai: OpenAI, openaiModel: string, systemPrompt: string, reviewFocus: string, octokit: OctokitType, owner: string, repo: string, contextFiles: ContextFile[]): Promise<{
    comments: ReviewComment[];
    summary: string;
}>;
export declare function filterFiles(files: FileData[], excludePatterns: string, maxFiles: number, includeDir?: string): FileData[];
