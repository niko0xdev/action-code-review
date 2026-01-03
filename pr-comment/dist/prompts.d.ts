import type { CommentContext } from './types';
declare function createSystemPrompt(): string;
declare function buildUserPrompt(context: CommentContext): string;
declare function addReplyMarker(replyBody: string): string;
export { createSystemPrompt, buildUserPrompt, addReplyMarker };
