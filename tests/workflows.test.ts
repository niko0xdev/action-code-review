import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = resolve(__dirname, '..');
const read = (file: string): string =>
	readFileSync(resolve(root, file), 'utf8');
const workflow = (file: string) => parse(read(file)) as Record<string, any>;

describe('repository workflows', () => {
	const files = [
		'.github/workflows/pr-review.yml',
		'.github/workflows/ci.yml',
		'.github/workflows/dependency-review.yml',
	];

	it.each(files)('%s pins third-party actions to commit SHAs', (file) => {
		const uses = [...read(file).matchAll(/^\s*uses:\s*(\S+)/gm)].map(
			(m) => m[1]
		);
		for (const ref of uses.filter((u) => !u.startsWith('./'))) {
			expect(ref, ref).toMatch(/@[0-9a-f]{40}$/);
		}
	});

	it.each(files)('%s does not persist the checkout token', (file) => {
		const wf = workflow(file);
		for (const job of Object.values<any>(wf.jobs)) {
			const checkout = job.steps.find((s: any) =>
				String(s.uses).startsWith('actions/checkout@')
			);
			// Jobs without a checkout (dependency review uses the API) are exempt.
			if (checkout) {
				expect(checkout.with['persist-credentials']).toBe(false);
			}
		}
	});

	it.each(files)('%s bounds runtime and concurrency', (file) => {
		const wf = workflow(file);
		expect(wf.concurrency?.group).toBeTruthy();
		for (const job of Object.values<any>(wf.jobs)) {
			expect(job['timeout-minutes']).toBeGreaterThan(0);
		}
	});

	it('self-review workflow only runs on pull requests', () => {
		expect(Object.keys(workflow('.github/workflows/pr-review.yml').on)).toEqual(
			['pull_request']
		);
	});

	it('CI runs read-only and gates on a reproducible build', () => {
		expect(workflow('.github/workflows/ci.yml').permissions).toEqual({
			contents: 'read',
		});
		const build = parse(read('package.json')).scripts.build as string;
		expect(build).not.toContain('npx');
		expect(read('.github/workflows/ci.yml')).toContain('git diff --exit-code');
	});

	it('dependency review is read-only, high-severity, and without licence rules', () => {
		const wf = workflow('.github/workflows/dependency-review.yml');
		expect(wf.permissions).toEqual({ contents: 'read' });
		const job = wf.jobs['dependency-review'];
		expect(job.permissions).toBeUndefined();
		expect(job.if).toBe("${{ vars.DEPENDENCY_REVIEW_ENABLED == 'true' }}");
		expect(job['continue-on-error']).toBeUndefined();
		const step = job.steps.find((s: any) =>
			String(s.uses).startsWith('actions/dependency-review-action@')
		);
		expect(step.with['fail-on-severity']).toBe('high');
		expect(step.with['comment-summary-in-pr']).toBe('never');
		expect(step.with['license-check']).toBe(false);
		expect(step.with['deny-licenses']).toBeUndefined();
	});

	it('harden-runner is first and audit-only, and stays out of the review job', () => {
		for (const file of [
			'.github/workflows/ci.yml',
			'.github/workflows/dependency-review.yml',
		]) {
			for (const job of Object.values<any>(workflow(file).jobs)) {
				expect(job.steps[0].uses, file).toMatch(
					/^step-security\/harden-runner@[0-9a-f]{40}$/
				);
				expect(job.steps[0].with['egress-policy']).toBe('audit');
			}
		}
		expect(read('.github/workflows/pr-review.yml')).not.toContain(
			'harden-runner'
		);
	});
});
