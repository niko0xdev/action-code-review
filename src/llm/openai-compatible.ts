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
		message?: {
			content?: string | null;
			reasoning_content?: string | null;
		};
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

		try {
			const response = await this.fetchImpl(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
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

			// Keep the same deadline through response body parsing. A server can
			// send headers and then stall indefinitely on a large JSON body.
			const payload = (await response.json()) as WireResponse;
			const choice = payload.choices?.[0];
			return {
				content: stripReasoningArtifacts(
					choice?.message?.content,
					choice?.message?.reasoning_content
				),
				finishReason: choice?.finish_reason,
				usage: payload.usage
					? {
							inputTokens: payload.usage.prompt_tokens ?? 0,
							outputTokens: payload.usage.completion_tokens ?? 0,
						}
					: undefined,
			};
		} catch (error) {
			if (error instanceof LlmError) throw error;
			throw new LlmError(
				`LLM request failed: ${error instanceof Error ? error.message : String(error)}`
			);
		} finally {
			clearTimeout(timer);
		}
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

/**
 * Strip reasoning-model artifacts before downstream parsing. Some gateways
 * surface chain-of-thought in a separate `reasoning_content` field or inline
 * `<think>...</think>` tags; both would poison JSON extraction and could
 * leak internal deliberation into PR comments.
 */
export function stripReasoningArtifacts(
	content?: string | null,
	reasoningContent?: string | null
): string {
	let text = content ?? '';
	if (reasoningContent) {
		const escaped = reasoningContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (escaped) text = text.replace(new RegExp(escaped, 'g'), '');
	}
	return (
		text
			// Unclosed tag = truncated model output mid-reasoning. Drop the
			// tail (reasoning) rather than the head (JSON payload).
			.replace(/<think(?:ing)?>[\s\S]*?(?:<\/(?:think|thinking)>|$)/gi, '')
			.trim()
	);
}

export function scrubSecrets(text: string): string {
	return text.replace(
		/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+/=-]+|(?:sk-|gh[oprsu]_|xox[abprs]-|AIza|github_pat_)[A-Za-z0-9._~+/=-]*/gi,
		'[REDACTED-TOKEN]'
	);
}

/** Extract response details without leaking Authorization material. */
export async function safeErrorDetail(response: Response): Promise<string> {
	const text = await response.text().catch(() => '');
	return scrubSecrets(text).slice(0, 500);
}

/** Upper bound on parsed candidates, so hostile text cannot force unbounded JSON.parse work. */
const MAX_JSON_CANDIDATES = 24;

/**
 * Collect every balanced `{...}` region in `text`, ignoring braces that appear
 * inside JSON strings. A prose answer can contain brace-like noise, so a single
 * first-brace/last-brace slice is not enough.
 */
function balancedObjectCandidates(text: string): string[] {
	const candidates: string[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			// Only meaningful once a candidate opened; outside one it is prose.
			if (depth > 0) inString = true;
			continue;
		}
		if (char === '{') {
			if (depth === 0) start = index;
			depth += 1;
			continue;
		}
		if (char === '}') {
			if (depth === 0) continue;
			depth -= 1;
			if (depth === 0 && start !== -1) {
				candidates.push(text.slice(start, index + 1));
				if (candidates.length >= MAX_JSON_CANDIDATES) return candidates;
				start = -1;
			}
		}
	}
	return candidates;
}

/**
 * Pull a JSON object out of an LLM response. Handles bare JSON, markdown-fenced
 * JSON, and JSON embedded in prose where earlier prose (or scratch objects)
 * would otherwise corrupt a naive first-brace/last-brace slice.
 *
 * @param text Raw model output.
 * @param preferKeys When provided, the first parsed candidate containing any of
 *   these keys wins; otherwise the first parseable object wins.
 */
export function extractJsonBlock(
	text: string,
	preferKeys?: readonly string[]
): Record<string, unknown> | null {
	const candidates: string[] = [];
	const collect = (raw: string): void => {
		const trimmed = raw.trim();
		if (!trimmed) return;
		if (trimmed.startsWith('{') && trimmed.endsWith('}'))
			candidates.push(trimmed);
		for (const balanced of balancedObjectCandidates(trimmed)) {
			if (balanced !== trimmed) candidates.push(balanced);
		}
	};
	const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
	for (const match of text.matchAll(fencedPattern)) {
		if (match[1]) collect(match[1]);
	}
	for (const balanced of balancedObjectCandidates(text)) collect(balanced);

	const parsed: Record<string, unknown>[] = [];
	for (const candidate of candidates.slice(0, MAX_JSON_CANDIDATES * 2)) {
		try {
			const value = JSON.parse(candidate) as unknown;
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				const record = value as Record<string, unknown>;
				if (!preferKeys || preferKeys.some((key) => key in record))
					return record;
				parsed.push(record);
			}
		} catch {
			// Not JSON — keep scanning.
		}
	}
	return parsed[0] ?? null;
}
