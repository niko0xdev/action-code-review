/**
 * LLM provider abstraction. V2 treats the endpoint as an OpenAI-compatible
 * gateway (spec §7): never OpenAI-specific, capability flags instead of
 * model-name conditionals (spec §30).
 */
export const DEFAULT_CAPABILITIES = {
    supportsReasoning: false,
    // Widest gateway compatibility: many OpenAI-compatible servers reject
    // the "developer" role.
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
    maxContext: 128_000,
    maxOutputTokens: 16_384,
};
export class LlmError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'LlmError';
    }
}
//# sourceMappingURL=provider.js.map