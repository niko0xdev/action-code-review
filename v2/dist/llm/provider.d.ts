/**
 * LLM provider abstraction. V2 treats the endpoint as an OpenAI-compatible
 * gateway (spec §7): never OpenAI-specific, capability flags instead of
 * model-name conditionals (spec §30).
 */
export interface LlmConfig {
    /** Logical provider name; "openai" is the V2 default (Pi built-in OpenAI-compatible provider). */
    provider: string;
    apiKey: string;
    /** OpenAI-compatible base URL, e.g. https://gateway.example.com/v1 */
    baseUrl: string;
    model: string;
}
/**
 * Capability knobs gateways differ on (spec §30). Application code must
 * branch on these, never on model names.
 */
export interface ProviderCapabilities {
    supportsReasoning: boolean;
    supportsDeveloperRole: boolean;
    /** Which request field carries the output-token cap. */
    maxTokensField: 'max_completion_tokens' | 'max_tokens';
    maxContext: number;
    maxOutputTokens: number;
}
export declare const DEFAULT_CAPABILITIES: ProviderCapabilities;
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface ChatCompletion {
    content: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    finishReason?: string;
}
/** Minimal chat surface every provider transport must implement. */
export interface LlmProvider {
    complete(messages: ChatMessage[], options?: {
        temperature?: number;
        maxOutputTokens?: number;
    }): Promise<ChatCompletion>;
}
export declare class LlmError extends Error {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
//# sourceMappingURL=provider.d.ts.map