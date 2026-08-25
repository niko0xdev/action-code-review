import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmConfig } from '../llm/provider.js';

/**
 * Runtime configuration for the Pi child process. The normalized LLM
 * config (from the frozen OPENAI_* variables) is materialized as a
 * models.json in a temp dir pointed at via PI_CODING_AGENT_DIR — nothing
 * touches ~/.pi and the directory dies with the runner.
 */

export function buildPiRuntimeModelsJson(config: LlmConfig): string {
	return JSON.stringify(
		{
			providers: {
				[config.provider]: {
					name: config.provider,
					baseUrl: config.baseUrl,
					apiKey: config.apiKey,
					api: 'openai-completions',
					compat: {
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
					},
					models: [
						{
							id: config.model,
							name: config.model,
							reasoning: false,
							input: ['text'],
							contextWindow: 128_000,
							maxTokens: 16_384,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				},
			},
		},
		null,
		2
	);
}

export interface PiRuntimeConfig {
	configDir: string;
	cleanup(): Promise<void>;
}

export async function preparePiRuntimeConfig(
	config: LlmConfig
): Promise<PiRuntimeConfig> {
	const configDir = await mkdtemp(join(tmpdir(), 'acr-v2-pi-'));
	await writeFile(
		join(configDir, 'models.json'),
		buildPiRuntimeModelsJson(config),
		'utf8'
	);
	return {
		configDir,
		async cleanup() {
			await rm(configDir, { recursive: true, force: true });
		},
	};
}
