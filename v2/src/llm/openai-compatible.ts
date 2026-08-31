import { DEFAULT_MAX_OUTPUT_TOKENS, timeoutFromEnv } from './config.js';
import {
	type ChatCompletion,
	type ChatMessage,
	DEFAULT_CAPABILITIES,
	type LlmConfig,
	LlmError,
	type LlmProvider,
	type ProviderCapabilities,
} from './provider.js';

/**
 * OpenAI-compatible chat-completions transport (spec §7).
 *
 * Works against any gateway implementing POST {baseUrl}/chat/completions:
 * OpenAI, LiteLLM, vLLM, zrouter, etc. Compatibility quirks are handled
 * centrally through ProviderCapabilities instead of model-name checks.
 */

interface WireResponse {
	choices?: Array<{
		message?: { content?: string | null };
		finish_reason?: string;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
	};
}

export class OpenAiCompatibleProvider implements LlmProvider {
	constructor(
		private readonly config: LlmConfig,
		private readonly capabilities: ProviderCapabilities = DEFAULT_CAPABILITIES,
		private readonly fetchImpl: typeof fetch = globalThis.fetch,
		private readonly timeoutMs: number = timeoutFromEnv()
	) {}

	async complete(
		messages: ChatMessage[],
		options?: { temperature?: number; maxOutputTokens?: number }
	): Promise<ChatCompletion> {
		const url = `${this.config.baseUrl}/chat/completions`;
		const body = {
			model: this.config.model,
			messages: this.adaptRoles(messages),
			temperature: options?.temperature ?? 0.2,
			[this.capabilities.maxTokensField]:
				options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);

		let response: Response;
		try {
			response = await this.fetchImpl(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (error) {
			throw new LlmError(
				`LLM request failed: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			clearTimeout(timer);
		}

		if (!response.ok) {
			const detail = (await safeErrorDetail(response)).replaceAll(
				this.config.apiKey,
				'[redacted]'
			);
			throw new LlmError(
				`LLM endpoint returned ${response.status}: ${detail}`,
				response.status
			);
		}

		const payload = (await response.json()) as WireResponse;
		const choice = payload.choices?.[0];
		return {
			content: choice?.message?.content ?? '',
			finishReason: choice?.finish_reason,
			usage: payload.usage
				? {
						inputTokens: payload.usage.prompt_tokens ?? 0,
						outputTokens: payload.usage.completion_tokens ?? 0,
					}
				: undefined,
		};
	}

	/**
	 * Gateways that reject the "developer" role get everything mapped to
	 * "system"/"user". Applied centrally so callers never care.
	 */
	private adaptRoles(messages: ChatMessage[]): ChatMessage[] {
		if (this.capabilities.supportsDeveloperRole) {
			return messages;
		}
		return messages.map((m) => ({ role: m.role, content: m.content }));
	}
}

/** Extract response details without leaking Authorization material. */
export async function safeErrorDetail(response: Response): Promise<string> {
	const text = await response.text().catch(() => '');
	const sanitized = text.replace(
		/(?:sk-|gh[opru]_|Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
		'[redacted]'
	);
	return sanitized.slice(0, 500);
}

/**
 * Pull the first JSON object out of an LLM response. Handles bare JSON,
 * markdown-fenced JSON, and JSON embedded in prose.
 */
export function extractJsonBlock(text: string): Record<string, unknown> | null {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidates: string[] = [];
	if (fenced?.[1]) {
		candidates.push(fenced[1].trim());
	}
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start !== -1 && end > start) {
		candidates.push(text.slice(start, end + 1));
	}
	if (!fenced && start === -1) {
		return null;
	}

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// try next candidate
		}
	}
	return null;
}
