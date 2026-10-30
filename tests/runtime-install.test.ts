import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { PI_PACKAGE, PI_PACKAGE_PIN } from '../src/adapter/pi-install.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
			uses?: string;
			with?: Record<string, string>;
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

// Frozen V1 required-flags and defaults (docs/v1-interface-contract.md).
// Inlined so the contract needs no snapshot files to compare against.
const FROZEN_INPUTS = {
	'pr-content': {
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
	},
	'pr-review': {
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
			default: '*.md,*.txt',
		},
		'include-dir': { required: false },
		'auto-approve-when-resolved': { required: false, default: 'false' },
		'min-severity': { required: false, default: 'critical' },
		'block-on-issues': { required: false, default: 'true' },
		'include-full-content': { required: false, default: 'false' },
		'max-context-chars': { required: false, default: '30000' },
	},
} as const;

describe.each([
	['pr-content/action.yml', 'pr-content'],
	['pr-review/action.yml', 'pr-review'],
] as const)('composite runtime: %s', (actionPath, action) => {
	const hasPiInstall = action === 'pr-review';
	const parsed = loadAction(actionPath);

	it('declares a composite runner', () => {
		expect(parsed.runs.using).toBe('composite');
	});

	it('keeps every frozen input with identical required flags and defaults', () => {
		const contract = FROZEN_INPUTS[action];
		const actual = Object.keys(parsed.inputs ?? {}).sort();
		for (const key of Object.keys(contract).sort()) {
			expect(actual, `missing frozen input ${key}`).toContain(key);
		}
		for (const [name, expected] of Object.entries(contract)) {
			expect(parsed.inputs?.[name]?.required ?? false, `${name}.required`).toBe(
				expected.required
			);
			if (
				'default' in expected &&
				(expected as { default?: string }).default !== undefined
			) {
				expect(parsed.inputs?.[name]?.default, `${name}.default`).toBe(
					(expected as { default?: string }).default
				);
			}
		}
	});

	it('pins actions/setup-node to a full commit SHA', () => {
		const step = parsed.runs.steps?.find((s) =>
			s.uses?.includes('actions/setup-node')
		);
		expect(step?.uses).toMatch(/^actions\/setup-node@[0-9a-f]{40}$/);
	});

	it.skipIf(!hasPiInstall)(
		'provisions pinned Node.js before the Pi install step',
		() => {
			const steps = parsed.runs.steps ?? [];
			const setupNodeIndex = steps.findIndex((step) =>
				step.uses?.includes('actions/setup-node')
			);
			const installIndex = steps.findIndex((step) =>
				step.run?.includes('pi-runtime')
			);
			expect(setupNodeIndex).toBeGreaterThanOrEqual(0);
			expect(steps[setupNodeIndex]?.with?.['node-version']).toBe('24');
			expect(setupNodeIndex).toBeLessThan(installIndex);
		}
	);

	it.skipIf(hasPiInstall)(
		'does not install Pi (the engine never spawns it)',
		() => {
			const raw = readFileSync(resolve(repoRoot, actionPath), 'utf8');
			expect(raw).not.toContain('pi-coding-agent');
			expect(raw).not.toContain('command -v pi');
		}
	);

	it.skipIf(!hasPiInstall)(
		'installs Pi from the lockfile in an idempotent bash pre-step',
		() => {
			const installStep = parsed.runs.steps?.find((step) =>
				step.run?.includes('pi-runtime')
			);
			expect(installStep).toBeDefined();
			expect(installStep?.run).toContain('npm ci');
			expect(installStep?.run).toContain('--ignore-scripts');
			expect(installStep?.run).not.toContain('npm install');
			expect(installStep?.shell).toBe('bash');
			expect(installStep?.run).toContain('command -v pi');
		}
	);

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

describe('pr-review install step', () => {
	const step = loadAction('pr-review/action.yml').runs.steps?.find(
		(candidate) => candidate.name === 'Setup harness loop'
	);
	const script = step?.run ?? '';

	it('installs from the lockfile without running lifecycle scripts', () => {
		expect(step?.shell).toBe('bash');
		expect(script).toContain(
			'npm ci --prefix "$GITHUB_ACTION_PATH/pi-runtime" --ignore-scripts'
		);
	});

	it('puts the installed binary on PATH', () => {
		expect(script).toContain(
			'echo "$GITHUB_ACTION_PATH/pi-runtime/node_modules/.bin" >> "$GITHUB_PATH"'
		);
	});

	it('only skips the install when the pinned version already resolves', () => {
		expect(script).toContain('! command -v pi');
		const pattern = script.match(/grep -Eq '([^']+)'/)?.[1] ?? '';
		const regex = new RegExp(pattern);
		expect(regex.test(PI_PACKAGE_PIN)).toBe(true);
		expect(regex.test(`${PI_PACKAGE_PIN}0`)).toBe(false);
		expect(regex.test(PI_PACKAGE_PIN.replace('.73.', '.7x3.'))).toBe(false);
		expect(pattern.replaceAll('\\', '')).toContain(`^${PI_PACKAGE_PIN}`);
	});

	it('records an integrity hash and an npm registry URL for every locked package', () => {
		const lock = JSON.parse(
			readFileSync(
				resolve(repoRoot, 'pr-review/pi-runtime/package-lock.json'),
				'utf8'
			)
		) as {
			packages: Record<
				string,
				{ integrity?: string; resolved?: string; link?: boolean }
			>;
		};
		const entries = Object.entries(lock.packages).filter(
			([path]) => path !== ''
		);
		expect(entries.length).toBeGreaterThan(0);
		for (const [path, entry] of entries) {
			expect(entry.integrity, `${path} integrity`).toMatch(/^sha(256|512)-/);
			expect(entry.resolved, `${path} resolved`).toMatch(
				/^https:\/\/registry\.npmjs\.org\//
			);
		}
	});

	it('keeps the lock-pinned Pi runtime in step with PI_PACKAGE_PIN', () => {
		const manifest = JSON.parse(
			readFileSync(
				resolve(repoRoot, 'pr-review/pi-runtime/package.json'),
				'utf8'
			)
		) as { dependencies: Record<string, string> };
		expect(manifest.dependencies[PI_PACKAGE]).toBe(PI_PACKAGE_PIN);
		const lock = JSON.parse(
			readFileSync(
				resolve(repoRoot, 'pr-review/pi-runtime/package-lock.json'),
				'utf8'
			)
		) as { packages: Record<string, { version?: string }> };
		expect(lock.packages[`node_modules/${PI_PACKAGE}`]?.version).toBe(
			PI_PACKAGE_PIN
		);
	});
});
