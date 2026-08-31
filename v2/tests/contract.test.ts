import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface ActionYml {
	name: string;
	description: string;
	author: string;
	inputs?: Record<
		string,
		{ description: string; required?: boolean; default?: string }
	>;
	outputs?: Record<string, { description: string }>;
	runs: { using: string; main: string };
}

function loadAction(relativePath: string): ActionYml {
	const raw = readFileSync(resolve(repoRoot, relativePath), 'utf8');
	return parseDocument(raw).toJS() as ActionYml;
}

// The frozen V1 contract (docs/v1-interface-contract.md). Any diff between
// these expectations and the action.yml files is a compatibility regression.
const PR_CONTENT_INPUTS = {
	'github-token': { required: true },
	'openai-api-key': { required: true },
	'openai-base-url': { required: false },
	'openai-model': { required: false, default: 'gpt-4' },
	'max-tokens': { required: false, default: '1000' },
	'include-file-list': { required: false, default: 'true' },
	'custom-instructions': { required: false, default: '' },
	'template-path': {
		required: false,
		default: '.github/pull_request_template.md',
	},
} as const;

const PR_REVIEW_INPUTS = {
	'github-token': { required: true },
	'openai-api-key': { required: true },
	'openai-base-url': { required: false },
	'openai-model': { required: false, default: 'gpt-4' },
	'review-prompt': {
		required: false,
		default:
			'Focus on correctness, code quality, security, performance, test coverage, and best practices. Provide actionable, line-specific feedback whenever possible.',
	},
	'max-files': { required: false, default: '10' },
	'exclude-patterns': {
		required: false,
		default: '*.md,*.txt,*.json,*.yml,*.yaml',
	},
	'include-dir': { required: false },
	'auto-approve-when-resolved': { required: false, default: 'false' },
	'min-severity': { required: false, default: 'critical' },
	'block-on-issues': { required: false, default: 'true' },
	'include-full-content': { required: false, default: 'false' },
	'max-context-chars': { required: false, default: '30000' },
} as const;

describe('V1 contract: pr-content/action.yml', () => {
	const action = loadAction('pr-content/action.yml');

	it('keeps the legacy entry point name', () => {
		expect(action.name).toBe('Auto-update PR Content');
	});

	it('runs as a composite action executing the legacy dist entry', () => {
		// The runner type is an implementation detail; the public surface
		// (name, inputs, outputs) is what stays frozen. Composite lets the
		// action provision its own Pi runtime before invoking dist/index.js.
		const steps = (action.runs as { steps?: Array<{ run?: string }> }).steps;
		expect(action.runs.using).toBe('composite');
		expect(steps?.some((step) => step.run?.includes('dist/index.js'))).toBe(
			true
		);
	});

	it('exposes exactly the frozen inputs', () => {
		expect(Object.keys(action.inputs ?? {}).sort()).toEqual(
			Object.keys(PR_CONTENT_INPUTS).sort()
		);
	});

	it('preserves required flags and defaults', () => {
		for (const [name, expected] of Object.entries(PR_CONTENT_INPUTS)) {
			const input = action.inputs?.[name];
			expect(input, `input ${name}`).toBeDefined();
			expect(input?.required ?? false, `${name}.required`).toBe(
				expected.required
			);
			if ('default' in expected) {
				expect(input?.default, `${name}.default`).toBe(expected.default);
			}
		}
	});

	it('declares no outputs (legacy parity)', () => {
		expect(action.outputs ?? {}).toEqual({});
	});
});

describe('V1 contract: pr-review/action.yml', () => {
	const action = loadAction('pr-review/action.yml');

	it('keeps the legacy entry point name', () => {
		expect(action.name).toBe('AI Code Review');
	});

	it('runs as a composite action executing the legacy dist entry', () => {
		const steps = (action.runs as { steps?: Array<{ run?: string }> }).steps;
		expect(action.runs.using).toBe('composite');
		expect(steps?.some((step) => step.run?.includes('dist/index.js'))).toBe(
			true
		);
	});

	it('exposes at least the frozen inputs (additive only)', () => {
		const actual = Object.keys(action.inputs ?? {}).sort();
		for (const key of Object.keys(PR_REVIEW_INPUTS).sort()) {
			expect(actual, `missing frozen input ${key}`).toContain(key);
		}
	});

	it('preserves required flags and defaults', () => {
		for (const [name, expected] of Object.entries(PR_REVIEW_INPUTS)) {
			const input = action.inputs?.[name];
			expect(input, `input ${name}`).toBeDefined();
			expect(input?.required ?? false, `${name}.required`).toBe(
				expected.required
			);
			if ('default' in expected) {
				expect(input?.default, `${name}.default`).toBe(expected.default);
			}
		}
	});

	it('exposes the frozen review-summary output', () => {
		expect(Object.keys(action.outputs ?? {})).toEqual(['review-summary']);
	});
});

describe('V1 contract: environment variable names', () => {
	it('documents the three frozen OPENAI_* variables in the contract doc', () => {
		const doc = readFileSync(
			resolve(repoRoot, 'docs/v1-interface-contract.md'),
			'utf8'
		);
		for (const env of [
			'OPENAI_API_KEY',
			'OPENAI_API_URL',
			'OPENAI_API_MODEL',
		]) {
			expect(doc).toContain(env);
		}
	});
});
