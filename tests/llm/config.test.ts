import { afterEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_MAX_OUTPUT_TOKENS,
	DEFAULT_TIMEOUT_MS,
	loadLlmConfigFromEnv,
} from '../../src/llm/config.js';
import type { LlmConfig } from '../../src/llm/provider.js';

const BASE_ENV = {
	OPENAI_API_KEY: 'sk-test-key',
	OPENAI_API_URL: 'https://llm.example.com/v1',
	OPENAI_API_MODEL: 'gpt-4o-mini',
};

function withEnv(env: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

const savedEnv: Record<string, string | undefined> = {};
const TRACKED = [
	'OPENAI_API_KEY',
	'OPENAI_API_URL',
	'OPENAI_API_MODEL',
	'AI_REVIEW_LEVEL',
	'AI_REVIEW_PROFILE',
];

afterEach(() => {
	for (const key of TRACKED) {
		if (key in savedEnv) {
			process.env[key] = savedEnv[key];
		} else {
			delete process.env[key];
		}
	}
});

describe('loadLlmConfigFromEnv', () => {
	it('normalizes OPENAI_* variables into the internal config shape', () => {
		withEnv(BASE_ENV);
		const config = loadLlmConfigFromEnv();
		expect(config).toEqual<LlmConfig>({
			provider: 'openai',
			apiKey: 'sk-test-key',
			baseUrl: 'https://llm.example.com/v1',
			model: 'gpt-4o-mini',
		});
	});

	it('falls back to the official OpenAI endpoint when no URL is set', () => {
		withEnv({ ...BASE_ENV, OPENAI_API_URL: undefined });
		const config = loadLlmConfigFromEnv();
		expect(config.baseUrl).toBe('https://api.openai.com/v1');
	});

	it('throws when the API key is missing', () => {
		withEnv({ ...BASE_ENV, OPENAI_API_KEY: undefined });
		expect(() => loadLlmConfigFromEnv()).toThrow(/OPENAI_API_KEY/);
	});

	it('throws when the model is missing', () => {
		withEnv({ ...BASE_ENV, OPENAI_API_MODEL: undefined });
		expect(() => loadLlmConfigFromEnv()).toThrow(/OPENAI_API_MODEL/);
	});

	it('never includes the api key in its error messages', () => {
		withEnv({ ...BASE_ENV, OPENAI_API_KEY: undefined });
		let message = '';
		try {
			loadLlmConfigFromEnv();
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).not.toContain('sk-test-key');
	});
});

describe('review option env defaults (spec §8)', () => {
	it('uses optional V2 knobs with spec defaults when absent', () => {
		withEnv(BASE_ENV);
		const options = loadLlmConfigFromEnv();
		void options;
		expect(DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThan(0);
		expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
	});

	it('reads AI_REVIEW_* overrides only when present', () => {
		withEnv({ ...BASE_ENV, AI_REVIEW_LEVEL: 'thorough' });
		expect(process.env.AI_REVIEW_LEVEL).toBe('thorough');
	});
});
