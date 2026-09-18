import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface ActionYml {
	name: string;
	description: string;
	author: string;
	inputs?: Record<
		string,
		{ description: string; required?: boolean; default?: string }
	>;
	outputs?: Record<string, { description: string; value?: string }>;
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
	'auto-approve-when-resolved': { required: false, default: 'true' },
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

	it('exposes at least the frozen review-summary output (additive security outputs allowed)', () => {
		expect(Object.keys(action.outputs ?? {})).toContain('review-summary');
	});
	it('exposes expected additive security outputs when security mode is enabled', () => {
		const outs = Object.keys(action.outputs ?? {});
		for (const key of [
			'security_findings',
			'security_findings_count',
			'security_risk',
			'security_sarif_path',
			'security_report_path',
			'security_conclusion',
		]) {
			expect(outs, `missing security output ${key}`).toContain(key);
		}
	});

	it('maps the additive machine-readable review-report output', () => {
		const report = action.outputs?.['review-report'] as
			| { description?: string; value?: string }
			| undefined;
		expect(report, 'missing review-report output').toBeDefined();
		expect(report?.value).toBe('${{ steps.run-review.outputs.review-report }}');
	});
});

describe('V1 contract: review-report README guidance', () => {
	const readme = () =>
		readFileSync(resolve(repoRoot, 'pr-review/README.md'), 'utf8');

	/**
	 * Pull the body of every fenced ```yaml block out of a Markdown document.
	 * The README examples are where consumers copy workflows from, so those
	 * blocks are the real attack surface.
	 */
	function yamlFences(markdown: string): string[] {
		return [...markdown.matchAll(/```ya?ml\n([\s\S]*?)```/g)].map((m) => m[1]);
	}

	/** Collect every `run:` script body, including multiline block scalars. */
	function runBodies(node: unknown, out: string[] = []): string[] {
		if (Array.isArray(node)) {
			for (const item of node) runBodies(item, out);
		} else if (node && typeof node === 'object') {
			for (const [key, value] of Object.entries(node)) {
				if (key === 'run' && typeof value === 'string') out.push(value);
				else runBodies(value, out);
			}
		}
		return out;
	}

	it('never interpolates review-report into shell source', () => {
		const doc = readme();
		const fences = yamlFences(doc);
		expect(fences.length).toBeGreaterThan(0);

		// Parse each fenced YAML example and inspect the actual run scripts, so
		// a multiline `run: |` block that interpolates the output is caught even
		// though it never shares a line with `run:`.
		const bodies = fences.flatMap((fence) =>
			runBodies(parseDocument(fence).toJS())
		);
		expect(bodies.length).toBeGreaterThan(0);
		for (const body of bodies) {
			expect(body).not.toContain('steps.review.outputs.review-report');
		}
		// The output must travel through env: and be consumed as data, so report
		// content can never be re-parsed as shell source.
		expect(doc).toContain(
			'REVIEW_REPORT: ${{ steps.review.outputs.review-report }}'
		);
	});

	it('keeps the fail-closed example running after a failed review step', () => {
		const doc = readme();
		expect(doc).toContain('if: always()');
		expect(doc).toContain('JSON.parse');
	});

	it('documents the provider-reported usage object and its caveat', () => {
		const doc = readme();
		// The additive usage fields consumers can read.
		for (const field of [
			'status',
			'inputTokens',
			'outputTokens',
			'cacheReadTokens',
			'cacheWriteTokens',
			'totalTokens',
			'assistantMessages',
			'toolCallsStarted',
			'durationMs',
			'processes',
		]) {
			expect(doc, `README must document usage.${field}`).toContain(field);
		}
		// Counters are provider-reported and may under-report an interrupted call.
		expect(doc).toMatch(/provider-reported/i);
		expect(doc).toMatch(/interrupt/i);
	});

	it('documents the usage object in the frozen contract doc', () => {
		const doc = readFileSync(
			resolve(repoRoot, 'docs/v1-interface-contract.md'),
			'utf8'
		);
		expect(doc).toContain('"usage"');
		for (const field of [
			'inputTokens',
			'outputTokens',
			'cacheReadTokens',
			'cacheWriteTokens',
			'totalTokens',
			'assistantMessages',
			'toolCallsStarted',
			'durationMs',
			'processes',
		]) {
			expect(doc, `contract doc must document usage.${field}`).toContain(field);
		}
		expect(doc).toMatch(/provider-reported/i);
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
