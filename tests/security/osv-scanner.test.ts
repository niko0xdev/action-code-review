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

	it('reports failed, not skipped, when OSV is unreachable', async () => {
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

		expect(execution.status).toBe('failed');
		expect(execution.reason).toContain('network down');
		expect(findings).toHaveLength(0);
	});

	const pkgPatch = (n: number) =>
		Array.from({ length: n }, (_, i) => `+    "pkg-${i}": "1.0.${i}",`).join(
			'\n'
		);
	const vuln = { vulns: [{ id: 'GHSA-aaaa-bbbb-cccc', summary: 's' }] };
	// Marks the first query of every batch as vulnerable.
	const okBatch = async (_url: unknown, init?: { body?: string }) => {
		const queries = JSON.parse(init?.body ?? '{}').queries as unknown[];
		return new Response(
			JSON.stringify({ results: queries.map((_, i) => (i === 0 ? vuln : {})) })
		);
	};

	it('queries more than 50 dependencies in batches and reports success', async () => {
		const fetchMock = vi.fn(okBatch);
		vi.stubGlobal('fetch', fetchMock);

		const { execution, findings } = await runOsvDependencyScan([
			{ filename: 'package.json', patch: pkgPatch(120) },
		]);

		const sizes = fetchMock.mock.calls.map(
			([, init]) => JSON.parse(init?.body ?? '{}').queries.length
		);
		expect(sizes.sort((a, b) => b - a)).toEqual([50, 50, 20]);
		expect(execution.status).toBe('success');
		expect(execution.reason).toBeUndefined();
		expect(findings).toHaveLength(3);
	});

	it('never has more than 3 batches in flight', async () => {
		let inFlight = 0;
		let peak = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: unknown, init?: { body?: string }) => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await new Promise((r) => setTimeout(r, 5));
				inFlight--;
				return okBatch(url, init);
			})
		);
		await runOsvDependencyScan([
			{ filename: 'package.json', patch: pkgPatch(400) },
		]);
		expect(peak).toBeLessThanOrEqual(3);
	});

	it('reports failed but keeps findings when more than 500 dependencies are added', async () => {
		const fetchMock = vi.fn(okBatch);
		vi.stubGlobal('fetch', fetchMock);

		const { execution, findings } = await runOsvDependencyScan([
			{ filename: 'package.json', patch: pkgPatch(520) },
		]);

		expect(fetchMock).toHaveBeenCalledTimes(10);
		expect(execution.status).toBe('failed');
		expect(execution.reason).toContain('500 of 520');
		expect(execution.reason).toContain('20 not queried');
		expect(findings).toHaveLength(10);
		expect(execution.findings).toBe(10);
	});

	it('reports failed but keeps findings from successful batches when one batch errors', async () => {
		let call = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: unknown, init?: { body?: string }) => {
				if (++call === 2) return new Response('boom', { status: 503 });
				return okBatch(url, init);
			})
		);

		const { execution, findings } = await runOsvDependencyScan([
			{ filename: 'package.json', patch: pkgPatch(120) },
		]);

		expect(execution.status).toBe('failed');
		expect(execution.reason).toContain('1 of 3');
		expect(execution.reason).toContain('HTTP 503');
		expect(findings).toHaveLength(2);
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
