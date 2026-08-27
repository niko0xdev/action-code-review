import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
	PI_PACKAGE_PIN,
	buildInstallStepScript,
} from '../src/adapter/pi-install.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface ActionYml {
	name: string;
	inputs?: Record<
		string,
		{ description: string; required?: boolean; default?: string }
	>;
	outputs?: Record<string, { description: string }>;
	runs: {
		using: string;
		steps?: Array<{
			name?: string;
			shell?: string;
			run?: string;
			env?: Record<string, string>;
		}>;
	};
}

function loadAction(relativePath: string): ActionYml {
	const raw = readFileSync(resolve(repoRoot, relativePath), 'utf8');
	return parseDocument(raw).toJS() as ActionYml;
}

// Frozen V1 input enumeration (docs/v1-interface-contract.md).
const V1_INPUTS = {
	'pr-content': [
		'github-token',
		'openai-api-key',
		'openai-base-url',
		'openai-model',
		'max-tokens',
		'include-file-list',
		'custom-instructions',
		'template-path',
	],
	'pr-review': [
		'github-token',
		'openai-api-key',
		'openai-base-url',
		'openai-model',
		'review-prompt',
		'max-files',
		'exclude-patterns',
		'include-dir',
		'auto-approve-when-resolved',
		'min-severity',
		'block-on-issues',
		'include-full-content',
		'max-context-chars',
	],
} as const;

describe.each([
	['pr-content/action.yml', 'pr-content'],
	['pr-review/action.yml', 'pr-review'],
] as const)('composite runtime: %s', (actionPath, action) => {
	const parsed = loadAction(actionPath);

	it('declares a composite runner', () => {
		expect(parsed.runs.using).toBe('composite');
	});

	it('keeps every frozen input with identical required flags and defaults', () => {
		const contract = loadAction(
			action === 'pr-review'
				? 'docs/.v1-contract-snapshot/pr-review.action.yml'
				: 'docs/.v1-contract-snapshot/pr-content.action.yml'
		);
		expect(Object.keys(parsed.inputs ?? {}).sort()).toEqual(
			Object.keys(contract.inputs ?? {}).sort()
		);
		for (const [name, expected] of Object.entries(contract.inputs ?? {})) {
			expect(parsed.inputs?.[name]?.required ?? false, `${name}.required`).toBe(
				expected.required
			);
			if (expected.default !== undefined) {
				expect(parsed.inputs?.[name]?.default, `${name}.default`).toBe(
					expected.default
				);
			}
		}
	});

	it('installs Pi in an idempotent bash pre-step', () => {
		const installStep = parsed.runs.steps?.find((step) =>
			step.run?.includes('pi-coding-agent')
		);
		expect(installStep).toBeDefined();
		expect(installStep?.shell).toBe('bash');
		expect(installStep?.run).toContain('command -v pi');
	});

	it('forwards every V1 input to the node step via env', () => {
		const runStep = parsed.runs.steps?.find((step) =>
			step.run?.includes('dist/index.js')
		);
		expect(runStep).toBeDefined();
		for (const inputName of V1_INPUTS[action]) {
			// @actions/core getInput preserves hyphens in INPUT_<NAME>.
			const envKey = `INPUT_${inputName.replace(/ /g, '_').toUpperCase()}`;
			expect(runStep?.env?.[envKey], `${envKey} forwarded`).toBeDefined();
		}
	});

	it('runs the legacy dist entry via the node step', () => {
		const runStep = parsed.runs.steps?.find((step) =>
			step.run?.includes('dist/index.js')
		);
		expect(runStep?.run).toContain('${{ github.action_path }}/dist/index.js');
	});
});

describe('buildInstallStepScript', () => {
	it('skips installation when pi already resolves on PATH', () => {
		const script = buildInstallStepScript();
		expect(script.startsWith('if ! command -v pi')).toBe(true);
		expect(script).toContain('--no-audit --no-fund --silent');
		expect(script).toContain(`@mariozechner/pi-coding-agent@${PI_PACKAGE_PIN}`);
	});
});
