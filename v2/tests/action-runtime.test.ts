import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { PI_PACKAGE_PIN } from '../src/adapter/pi-install.js';

/**
 * Self-review: this repository eats its own cooking. These tests parse
 * the repo's own action.yml files so a CI run on any PR proves the
 * runtime packaging stays well-formed without touching production code.
 */

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
] as const)('action runtime self-review: %s', (actionPath, action) => {
	const parsed = loadAction(actionPath);

	it('parses as YAML and declares a composite runner', () => {
		expect(parsed.name).toBeTruthy();
		expect(parsed.runs.using).toBe('composite');
	});

	it('has at least two steps: Pi install + node entry', () => {
		expect(parsed.runs.steps?.length).toBeGreaterThanOrEqual(2);
	});

	it('guards the Pi install idempotently with the pinned package', () => {
		const installStep = parsed.runs.steps?.find((step) =>
			step.run?.includes('pi-coding-agent')
		);
		expect(installStep, 'install step exists').toBeDefined();
		expect(installStep?.shell).toBe('bash');
		expect(installStep?.run).toContain(
			'if ! command -v pi >/dev/null 2>&1; then'
		);
		expect(installStep?.run).toContain(
			`@mariozechner/pi-coding-agent@${PI_PACKAGE_PIN}`
		);
		expect(installStep?.run).toContain(
			'--no-audit --no-fund --ignore-scripts --silent'
		);
	});

	it('forwards every V1 input via env using the getInput convention', () => {
		const runStep = parsed.runs.steps?.find((step) =>
			step.run?.includes('dist/index.js')
		);
		expect(runStep, 'node entry step exists').toBeDefined();

		for (const inputName of V1_INPUTS[action]) {
			const inInputs = parsed.inputs?.[inputName] !== undefined;
			// @actions/core getInput reads INPUT_<NAME> with only spaces
			// replaced by underscores; hyphens are preserved. A wrong
			// mapping here breaks every composite invocation.
			const envKey = `INPUT_${inputName.replace(/ /g, '_').toUpperCase()}`;
			const inEnv = runStep?.env?.[envKey] !== undefined;
			expect(inEnv, `${envKey} forwarded for ${inputName}`).toBe(true);
			expect(inInputs, `${inputName} declared`).toBe(true);
		}
	});

	it('executes the bundled dist entry from the action path', () => {
		const runStep = parsed.runs.steps?.find((step) =>
			step.run?.includes('dist/index.js')
		);
		expect(runStep?.run).toContain('${{ github.action_path }}/dist/index.js');
	});
});

describe('pr-review outputs survive the composite conversion', () => {
	it('still exposes the frozen review-summary output', () => {
		const parsed = loadAction('pr-review/action.yml');
		expect(Object.keys(parsed.outputs ?? {})).toEqual(['review-summary']);
	});
});

describe('CI workflow self-review', () => {
	it('invokes the local pr-review action on pull requests', () => {
		const raw = readFileSync(
			resolve(repoRoot, '.github/workflows/pr-review.yml'),
			'utf8'
		);
		const workflow = parseDocument(raw).toJS() as {
			on?: Record<string, unknown> | string[];
			jobs?: Record<string, { steps?: Array<{ uses?: string }> }>;
		};
		expect(workflow.on).toBeDefined();
		const steps = Object.values(workflow.jobs ?? {}).flatMap(
			(job) => job.steps ?? []
		);
		expect(steps.some((step) => step.uses === './pr-review')).toBe(true);
	});
});
