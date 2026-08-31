import { type ChatCompletion, type ChatMessage, type LlmConfig, type LlmProvider, type ProviderCapabilities } from './provider.js';
export declare class OpenAiCompatibleProvider implements LlmProvider {
    private readonly config;
    private readonly capabilities;
    private readonly fetchImpl;
    private readonly timeoutMs;
    constructor(config: LlmConfig, capabilities?: ProviderCapabilities, fetchImpl?: typeof fetch, timeoutMs?: number);
    complete(messages: ChatMessage[], options?: {
        temperature?: number;
        maxOutputTokens?: number;
    }): Promise<ChatCompletion>;
    /**
     * Gateways that reject the "developer" role get everything mapped to
     * "system"/"user". Applied centrally so callers never care.
     */
    private adaptRoles;
}
export declare function scrubSecrets(text: string): string;
/** Extract response details without leaking Authorization material. */
export declare function safeErrorDetail(response: Response): Promise<string>;
/**
 * Pull the first JSON object out of an LLM response. Handles bare JSON,
 * markdown-fenced JSON, and JSON embedded in prose.
 */
export declare function extractJsonBlock(text: string): Record<string, unknown> | null;
//# sourceMappingURL=openai-compatible.d.ts.map