import { DEFAULT_MAX_OUTPUT_TOKENS, timeoutFromEnv } from './config.js';
import { DEFAULT_CAPABILITIES, LlmError, } from './provider.js';
export class OpenAiCompatibleProvider {
    config;
    capabilities;
    fetchImpl;
    timeoutMs;
    constructor(config, capabilities = DEFAULT_CAPABILITIES, fetchImpl = globalThis.fetch, timeoutMs = timeoutFromEnv()) {
        this.config = config;
        this.capabilities = capabilities;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
    }
    async complete(messages, options) {
        const url = `${this.config.baseUrl}/chat/completions`;
        const body = {
            model: this.config.model,
            messages: this.adaptRoles(messages),
            temperature: options?.temperature ?? 0.2,
            [this.capabilities.maxTokensField]: options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response;
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
        }
        catch (error) {
            throw new LlmError(`LLM request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            const detail = (await safeErrorDetail(response)).replaceAll(this.config.apiKey, '[redacted]');
            throw new LlmError(`LLM endpoint returned ${response.status}: ${detail}`, response.status);
        }
        const payload = (await response.json());
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
    adaptRoles(messages) {
        if (this.capabilities.supportsDeveloperRole) {
            return messages;
        }
        return messages.map((m) => ({ role: m.role, content: m.content }));
    }
}
export function scrubSecrets(text) {
    return text.replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+/=-]+|(?:sk-|gh[oprsu]_|xox[abprs]-|AIza|github_pat_)[A-Za-z0-9._~+/=-]*/gi, '[REDACTED-TOKEN]');
}
/** Extract response details without leaking Authorization material. */
export async function safeErrorDetail(response) {
    const text = await response.text().catch(() => '');
    return scrubSecrets(text).slice(0, 500);
}
/**
 * Pull the first JSON object out of an LLM response. Handles bare JSON,
 * markdown-fenced JSON, and JSON embedded in prose.
 */
export function extractJsonBlock(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [];
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
                return parsed;
            }
        }
        catch {
            // try next candidate
        }
    }
    return null;
}
//# sourceMappingURL=openai-compatible.js.map