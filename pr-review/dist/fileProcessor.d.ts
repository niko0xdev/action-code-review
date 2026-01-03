import OpenAI from 'openai';
import type { ReviewComment } from './reviewParser';
import type { FileData } from './types';
export declare function processFile(file: FileData, openai: OpenAI, openaiModel: string, systemPrompt: string, reviewFocus: string): Promise<{
    comments: ReviewComment[];
    summary: string;
}>;
export declare function filterFiles(files: FileData[], excludePatterns: string, maxFiles: number): FileData[];
