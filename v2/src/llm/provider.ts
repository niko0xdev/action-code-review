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

export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
	supportsReasoning: false,
	// Widest gateway compatibility: many OpenAI-compatible servers reject
	// the "developer" role.
	supportsDeveloperRole: false,
	maxTokensField: 'max_tokens',
	maxContext: 128_000,
	maxOutputTokens: 16_384,
};

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
	complete(
		messages: ChatMessage[],
		options?: { temperature?: number; maxOutputTokens?: number }
	): Promise<ChatCompletion>;
}

export class LlmError extends Error {
	constructor(
		message: string,
		public readonly status?: number
	) {
		super(message);
		this.name = 'LlmError';
	}
}
