import type OpenAI from 'openai';
import type { CommentContext } from './types';
/**
 * Generate an AI reply to a developer's question
 */
export declare function generateReply(openai: OpenAI, context: CommentContext, model: string, customPrompt?: string): Promise<string>;
/**
 * Validate the generated reply
 */
export declare function validateReply(replyBody: string): boolean;
