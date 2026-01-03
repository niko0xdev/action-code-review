import type { ContextFile } from './types';
declare const DEFAULT_REVIEW_FOCUS = "Focus on correctness, code quality, security, performance, test coverage, and best practices. Provide actionable, line-specific feedback whenever possible.";
declare function createSystemPrompt(): string;
declare function buildUserPrompt(filename: string, diff: string, reviewFocus: string, changedFileContent?: string, contextFiles?: ContextFile[]): string;
export { DEFAULT_REVIEW_FOCUS, buildUserPrompt, createSystemPrompt };
