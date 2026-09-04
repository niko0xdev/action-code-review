import { describe, expect, it, vi } from 'vitest';
import {
	OpenAiCompatibleProvider,
	extractJsonBlock,
	scrubSecrets,
} from '../../src/llm/openai-compatible.js';
import { safeErrorDetail } from '../../src/llm/openai-compatible.js';
import type { LlmConfig } from '../../src/llm/provider.js';

const CONFIG: LlmConfig = {
	provider: 'openai',
	apiKey: 'sk-test-key',
	baseUrl: 'https://llm.example.com/v1',
	model: 'gpt-4o-mini',
};

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function captureFetch(response: Response) {
	const fetchImpl = vi.fn(async () => response);
	return fetchImpl;
}

describe('OpenAiCompatibleProvider', () => {
	it('posts to {baseUrl}/chat/completions with bearer auth', async () => {
		const fetchImpl = captureFetch(
			jsonResponse({
				choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			})
		);
		const provider = new OpenAiCompatibleProvider(
			CONFIG,
			undefined,
			fetchImpl as typeof fetch
		);

		await provider.complete([{ role: 'user', content: 'hi' }]);

		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://llm.example.com/v1/chat/completions');
		expect((init.headers as Record<string, string>).Authorization).toBe(
			'Bearer sk-test-key'
		);
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe('gpt-4o-mini');
		expect(body.max_tokens).toBeDefined();
	});

	it('redacts all supported token forms globally', () => {
		const text =
			'sk-secret gho_one ghp_two ghs_three xoxb-four AIzafive github_pat_six eyJabc.eyJdef.sig Bearer ghp_seven';
		const scrubbed = scrubSecrets(text);
		expect(scrubbed).not.toContain('sk-secret');
		expect(scrubbed).not.toContain('gho_one');
		expect(scrubbed).not.toContain('ghp_two');
		expect(scrubbed).not.toContain('ghs_three');
		expect(scrubbed).not.toContain('xoxb-four');
		expect(scrubbed).not.toContain('AIzafive');
		expect(scrubbed).not.toContain('github_pat_six');
		expect(scrubbed).not.toContain('eyJabc.eyJdef.sig');
		expect(scrubbed).toMatch(/\[REDACTED-TOKEN\]/);
	});

	it('redacts response details before truncation', async () => {
		const detail = await safeErrorDetail(
			new Response('first Bearer ghp_xxx then sk-secret and eyJabc.eyJdef.sig')
		);
		expect(detail).not.toMatch(/ghp_xxx|sk-secret|eyJabc/);
	});

	it('returns content and usage from the response', async () => {
		const fetchImpl = captureFetch(
			jsonResponse({
				choices: [
					{ message: { content: 'review text' }, finish_reason: 'stop' },
				],
				usage: { prompt_tokens: 100, completion_tokens: 50 },
			})
		);
		const provider = new OpenAiCompatibleProvider(
			CONFIG,
			undefined,
			fetchImpl as typeof fetch
		);

		const result = await provider.complete([
			{ role: 'user', content: 'review this' },
		]);
		expect(result.content).toBe('review text');
		expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
	});

	it('maps non-2xx responses to LlmError without leaking the key', async () => {
		const response = new Response(
			JSON.stringify({ error: 'bad key sk-secret123 rejected' }),
			{ status: 401 }
		);
		const fetchImpl = captureFetch(response);
		const provider = new OpenAiCompatibleProvider(
			CONFIG,
			undefined,
			fetchImpl as typeof fetch
		);

		await expect(provider.complete([])).rejects.toThrow(/401/);
	});

	it('aborts when the endpoint exceeds the timeout', async () => {
		const fetchImpl = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('Aborted', 'AbortError'))
					);
				})
		);
		const provider = new OpenAiCompatibleProvider(
			CONFIG,
			undefined,
			fetchImpl as unknown as typeof fetch,
			10
		);

		await expect(
			provider.complete([{ role: 'user', content: 'x' }])
		).rejects.toThrow(/LLM request failed/);
	});
});

describe('extractJsonBlock', () => {
	it('parses a bare JSON object', () => {
		expect(extractJsonBlock('{"a":1}')).toEqual({ a: 1 });
	});

	it('parses JSON inside markdown fences', () => {
		const text = 'Here is the review:\n```json\n{"b":[1,2]}\n```\nDone.';
		expect(extractJsonBlock(text)).toEqual({ b: [1, 2] });
	});

	it('parses the first JSON object embedded in prose', () => {
		const text = 'Sure! {"findings": []} hope that helps';
		expect(extractJsonBlock(text)).toEqual({ findings: [] });
	});

	it('returns null for non-JSON output', () => {
		expect(extractJsonBlock('no structured data here')).toBeNull();
	});
});
