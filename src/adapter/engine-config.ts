import { normalizeBaseUrl } from '../llm/config.js';
import type { LlmConfig } from '../llm/provider.js';

/**
 * Engine configuration resolution: explicit action inputs win, the frozen
 * OPENAI_* environment variables are the fallback (spec §7/§27). This is
 * the single place where legacy names meet V2 config.
 */

export interface EngineConfigInput {
	apiKey: string;
	model: string;
	baseUrl?: string;
}

export function resolveEngineConfig(input: EngineConfigInput): LlmConfig {
	const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error(
			'Missing API key: provide the openai-api-key input or set OPENAI_API_KEY.'
		);
	}
	const model = input.model || process.env.OPENAI_API_MODEL;
	if (!model) {
		throw new Error(
			'Missing model id: provide the openai-model input or set OPENAI_API_MODEL.'
		);
	}
	const rawBaseUrl =
		input.baseUrl || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';

	return {
		provider: 'openai',
		apiKey,
		baseUrl: normalizeBaseUrl(rawBaseUrl),
		model,
	};
}
