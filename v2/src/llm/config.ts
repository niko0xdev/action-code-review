import type { LlmConfig } from './provider.js';

/**
 * Environment-driven configuration. The legacy OPENAI_* variable names are
 * frozen contract (docs/v1-interface-contract.md); V2 maps them into its
 * normalized config shape (spec §7/§27).
 */

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Spec §8 optional knobs with their recommended defaults. */
export const REVIEW_OPTION_DEFAULTS = {
	aiReviewLevel: 'standard',
	aiReviewMaxFiles: 100,
	aiReviewMaxFindings: 20,
	aiReviewMinConfidence: 0.8,
	aiReviewProfile: 'auto',
} as const;

export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_TIMEOUT_MS = 600_000;

export function loadLlmConfigFromEnv(
	env: NodeJS.ProcessEnv = process.env
): LlmConfig {
	const apiKey = env.OPENAI_API_KEY;
	const model = env.OPENAI_API_MODEL;

	if (!apiKey) {
		throw new Error(
			'Missing required environment variable OPENAI_API_KEY. Provide it as a GitHub secret mapped into the action inputs.'
		);
	}
	if (!model) {
		throw new Error(
			'Missing required environment variable OPENAI_API_MODEL. Set it to the model id served by your OpenAI-compatible endpoint.'
		);
	}

	return {
		provider: 'hubworx',
		apiKey,
		baseUrl: normalizeBaseUrl(env.OPENAI_API_URL || DEFAULT_BASE_URL),
		model,
	};
}

/** Accepts gateway URLs with or without a version path; always ends with /v1-style segment preserved or appended. */
export function normalizeBaseUrl(url: string): string {
	const trimmed = url.replace(/\/+$/, '');
	if (/\/v\d+$/.test(trimmed)) {
		return trimmed;
	}
	return `${trimmed}/v1`;
}
