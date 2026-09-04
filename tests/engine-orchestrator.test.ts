import { afterEach, describe, expect, it } from 'vitest';
import { resolveEngineConfig } from '../src/adapter/engine-config.js';

const TRACKED = ['OPENAI_API_KEY', 'OPENAI_API_URL', 'OPENAI_API_MODEL'];

afterEach(() => {
	for (const key of TRACKED) {
		delete process.env[key];
	}
});

describe('resolveEngineConfig', () => {
	it('prefers explicit action inputs over environment variables', () => {
		process.env.OPENAI_API_KEY = 'env-key';
		process.env.OPENAI_API_MODEL = 'env-model';

		const config = resolveEngineConfig({
			apiKey: 'input-key',
			model: 'input-model',
			baseUrl: 'https://gw.example.com',
		});

		expect(config).toEqual({
			provider: 'openai',
			apiKey: 'input-key',
			baseUrl: 'https://gw.example.com/v1',
			model: 'input-model',
		});
	});

	it('falls back to the frozen OPENAI_* env vars when inputs are absent', () => {
		process.env.OPENAI_API_KEY = 'env-key';
		process.env.OPENAI_API_URL = 'https://env.example.com/v1';
		process.env.OPENAI_API_MODEL = 'env-model';

		const config = resolveEngineConfig({ apiKey: '', model: '' });
		expect(config).toMatchObject({
			apiKey: 'env-key',
			baseUrl: 'https://env.example.com/v1',
			model: 'env-model',
		});
	});

	it('throws naming the missing variable when neither source is set', () => {
		expect(() => resolveEngineConfig({ apiKey: '', model: 'm' })).toThrow(
			/OPENAI_API_KEY/
		);
		expect(() => resolveEngineConfig({ apiKey: 'k', model: '' })).toThrow(
			/OPENAI_API_MODEL/
		);
	});
});
