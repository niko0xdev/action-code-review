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

export interface RetryOptions {
	maxAttempts?: number;
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
}

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Errors from a failed connection (not a timeout, not a bad body). */
const CONNECTION_ERRORS = new WeakSet<LlmError>();

/**
 * Transient: listed HTTP statuses and connection resets. Request timeouts and
 * unparseable 200 bodies are not retried: a timeout would multiply the
 * wait (workflow limits), and a bad body means the paid call already ran.
 */
function isTransient(error: unknown): boolean {
	if (!(error instanceof LlmError)) return false;
	if (error.status === undefined) return CONNECTION_ERRORS.has(error);
	return TRANSIENT_STATUS.has(error.status);
}

/** `Retry-After` as non-negative integer seconds or an HTTP date; else undefined. */
function parseRetryAfter(value: string | null): number | undefined {
	const text = value?.trim();
	if (!text) return undefined;
	if (/^\d+$/.test(text)) return Number(text) * 1000;
	if (!/[a-z]/i.test(text)) return undefined;
	const at = Date.parse(text);
	return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

export class OpenAiCompatibleProvider implements LlmProvider {
	constructor(
		private readonly config: LlmConfig,
		private readonly capabilities: ProviderCapabilities = DEFAULT_CAPABILITIES,
		private readonly fetchImpl: typeof fetch = globalThis.fetch,
		private readonly timeoutMs: number = timeoutFromEnv(),
		private readonly retry: RetryOptions = {}
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

		const maxAttempts = this.retry.maxAttempts ?? MAX_ATTEMPTS;
		const sleep = this.retry.sleep ?? defaultSleep;
		const random = this.retry.random ?? Math.random;
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.attempt(url, body);
			} catch (error) {
				if (attempt >= maxAttempts || !isTransient(error)) throw error;
				// Retry-After can lengthen the wait, never shorten it below backoff.
				const floor = Math.round(
					BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + random())
				);
				const delay = Math.max(floor, (error as LlmError).retryAfterMs ?? 0);
				await sleep(Math.min(delay, MAX_DELAY_MS));
			}
		}
	}

	/** One HTTP attempt with its own deadline, covering body parsing too. */
	private async attempt(
		url: string,
		body: Record<string, unknown>
	): Promise<ChatCompletion> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		const redact = (text: string) =>
			scrubSecrets(
				this.config.apiKey
					? text.replaceAll(this.config.apiKey, '[redacted]')
					: text
			);

		try {
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
				const failure = new LlmError(
					`LLM request failed: ${redact(error instanceof Error ? error.message : String(error))}`
				);
				if (!controller.signal.aborted) CONNECTION_ERRORS.add(failure);
				throw failure;
			}
			if (!response.ok) {
				const detail = redact(await safeErrorDetail(response));
				throw new LlmError(
					`LLM endpoint returned ${response.status}: ${detail}`,
					response.status,
					parseRetryAfter(response.headers.get('retry-after'))
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
				`LLM request failed: ${redact(error instanceof Error ? error.message : String(error))}`
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
