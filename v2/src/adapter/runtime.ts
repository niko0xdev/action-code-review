import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmConfig } from '../llm/provider.js';

export function buildPiRuntimeModelsJson(config: LlmConfig): string {
	return JSON.stringify(
		{
			providers: {
				[config.provider]: {
					name: config.provider,
					baseUrl: config.baseUrl,
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
	try {
		await writeFile(
			join(configDir, 'models.json'),
			buildPiRuntimeModelsJson(config),
			'utf8'
		);
	} catch (error) {
		await rm(configDir, { recursive: true, force: true });
		throw error;
	}
	return {
		configDir,
		async cleanup() {
			await rm(configDir, { recursive: true, force: true });
		},
	};
}
