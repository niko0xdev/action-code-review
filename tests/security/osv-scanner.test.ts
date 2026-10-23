import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	extractAddedDependencies,
	runOsvDependencyScan,
} from '../../src/security/scanners/osv-scanner.js';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('OsvDependencyScan', () => {
	it('extracts pinned npm deps from package.json diffs', () => {
		const deps = extractAddedDependencies([
			{
				filename: 'package.json',
				patch: `@@ -5,2 +5,4 @@
   "dependencies": {
+    "lodash": "4.17.21",
     "react": "^18.0.0"
   }`,
			},
		]);
		expect(deps).toHaveLength(1);
		expect(deps[0]).toMatchObject({
			name: 'lodash',
			version: '4.17.21',
			ecosystem: 'npm',
		});
	});

	it('extracts pinned deps from requirements.txt and go.mod', () => {
		const deps = extractAddedDependencies([
			{
				filename: 'requirements.txt',
				patch: `@@ -1,0 +1,2 @@
+requests==2.31.0
+flask>=3.0.0`,
			},
			{
				filename: 'go.mod',
				patch: `@@ -3,1 +3,2 @@
 require (
+	github.com/gin-gonic/gin v1.9.1
 )`,
			},
		]);
		expect(deps.map((d) => `${d.ecosystem}:${d.name}@${d.version}`)).toEqual([
			'PyPI:requests@2.31.0',
			'Go:github.com/gin-gonic/gin@v1.9.1',
		]);
	});

	it('reports OSV vulnerabilities as findings with remediation', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					results: [
						{
							vulns: [
								{
									id: 'GHSA-xxxx-yyyy-zzzz',
									summary: 'Prototype pollution in test package',
									severity: [{ type: 'CVSS_V3', score: '9.8' }],
									affected: [{ ranges: [{ events: [{ fixed: '4.17.22' }] }] }],
								},
							],
						},
					],
				}),
			}))
		);

		const { execution, findings } = await runOsvDependencyScan([
			{
				filename: 'package.json',
				patch: `@@ -5,2 +5,4 @@
   "dependencies": {
+    "lodash": "4.17.21",
     "react": "^18.0.0"
   }`,
			},
		]);

		expect(execution.status).toBe('success');
		expect(findings).toHaveLength(1);
		expect(findings[0].severity).toBe('critical');
		expect(findings[0].remediation).toContain('4.17.22');
		expect(findings[0].evidence[0].source).toBe('osv');
	});

	it('degrades to skipped when OSV is unreachable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);

		const { execution, findings } = await runOsvDependencyScan([
			{
				filename: 'package.json',
				patch: '+    "lodash": "4.17.21",',
			},
		]);

		expect(execution.status).toBe('skipped');
		expect(findings).toHaveLength(0);
	});

	it('skips when disabled or when no pinned deps are added', async () => {
		vi.stubEnv('OSV_SCAN_DISABLED', '1');
		const disabled = await runOsvDependencyScan([
			{ filename: 'package.json', patch: '+    "lodash": "4.17.21",' },
		]);
		expect(disabled.execution.status).toBe('skipped');
		vi.unstubAllEnvs();

		const empty = await runOsvDependencyScan([
			{ filename: 'src/api.ts', patch: '+const a = 1;' },
		]);
		expect(empty.execution.status).toBe('skipped');
		expect(empty.findings).toHaveLength(0);
	});
});
