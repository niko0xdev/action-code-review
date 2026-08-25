import { describe, expect, it } from 'vitest';
import { mapLegacyInputs } from '../src/adapter/legacy-inputs.js';
import {
	buildPiRuntimeModelsJson,
	preparePiRuntimeConfig,
} from '../src/adapter/runtime.js';

describe('mapLegacyInputs (docs/v1-interface-contract.md)', () => {
	it('maps every pr-review input into engine options', () => {
		const options = mapLegacyInputs('pr-review', {
			'github-token': 'tok',
			'openai-api-key': 'key',
			'openai-base-url': 'https://gw.example.com',
			'openai-model': 'm1',
			'review-prompt': 'Focus on X',
			'max-files': '7',
			'exclude-patterns': '*.md',
			'include-dir': 'src,lib',
			'auto-approve-when-resolved': 'true',
			'min-severity': 'high',
			'block-on-issues': 'false',
			'include-full-content': 'false',
			'max-context-chars': '20000',
		});
		expect(options).toMatchObject({
			githubToken: 'tok',
			apiKey: 'key',
			baseUrl: 'https://gw.example.com/v1',
			model: 'm1',
			reviewPrompt: 'Focus on X',
			maxFiles: 7,
			excludePatterns: ['*.md'],
			includeDirs: ['src', 'lib'],
			autoApproveWhenResolved: true,
			minSeverity: 'high',
			blockOnIssues: false,
		});
	});

	it('applies legacy defaults when inputs are empty', () => {
		const options = mapLegacyInputs('pr-review', {});
		expect(options.model).toBe('gpt-4');
		expect(options.maxFiles).toBe(10);
		expect(options.excludePatterns).toEqual([
			'*.md',
			'*.txt',
			'*.json',
			'*.yml',
			'*.yaml',
		]);
		expect(options.minSeverity).toBe('critical');
		expect(options.blockOnIssues).toBe(true);
		expect(options.autoApproveWhenResolved).toBe(false);
	});

	it('maps pr-content inputs into its own shape', () => {
		const options = mapLegacyInputs('pr-content', {
			'max-tokens': '500',
			'include-file-list': 'false',
			'template-path': 'tpl.md',
		});
		expect(options.maxTokens).toBe(500);
		expect(options.includeFileList).toBe(false);
		expect(options.templatePath).toBe('tpl.md');
	});
});

describe('buildPiRuntimeModelsJson', () => {
	it('registers a hubworx provider from the normalized config', () => {
		const json = buildPiRuntimeModelsJson({
			provider: 'hubworx',
			apiKey: 'sk-x',
			baseUrl: 'https://gw.example.com/v1',
			model: 'm1',
		});
		const parsed = JSON.parse(json) as {
			providers: Record<string, unknown>;
		};
		expect(Object.keys(parsed.providers)).toEqual(['hubworx']);
		const provider = parsed.providers.hubworx as Record<string, unknown>;
		expect(provider.baseUrl).toBe('https://gw.example.com/v1');
		expect(provider.api).toBe('openai-completions');
		expect(provider.apiKey).toBe('sk-x');
		const models = provider.models as Array<{ id: string }>;
		expect(models.map((m) => m.id)).toContain('m1');
	});
});

describe('preparePiRuntimeConfig', () => {
	it('writes models.json into the runtime dir and returns it', async () => {
		const { configDir, cleanup } = await preparePiRuntimeConfig({
			provider: 'hubworx',
			apiKey: 'sk-runtime',
			baseUrl: 'https://gw.example.com/v1',
			model: 'm1',
		});
		try {
			const content = await import('node:fs/promises').then((fs) =>
				fs.readFile(`${configDir}/models.json`, 'utf8')
			);
			expect(content).toContain('hubworx');
			expect(configDir).not.toContain('.pi');
		} finally {
			await cleanup();
		}
	});
});
