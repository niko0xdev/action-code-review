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
	// Flags the first and last query of every batch with an id derived from the
	// queried package, so a finding can only match its dependency if the scanner
	// maps each result back to the right dependency by index.
	const flagged = (queries: Array<{ package: { name: string } }>) =>
		queries.map((q, i) =>
			i === 0 || i === queries.length - 1
				? { vulns: [{ id: `GHSA-${q.package.name}`, summary: 's' }] }
				: {}
		);
	const parseQueries = (init?: { body?: string }) =>
		JSON.parse(init?.body ?? '{}').queries as Array<{
			package: { name: string };
		}>;
	const okBatch = async (_url: unknown, init?: { body?: string }) =>
		new Response(JSON.stringify({ results: flagged(parseQueries(init)) }));
	const titleFor = (n: number) =>
		`Known vulnerability GHSA-pkg-${n} in pkg-${n}@1.0.${n}`;
	const titles = (findings: Array<{ title: string }>) =>
		findings.map((f) => f.title).sort();

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
		expect(titles(findings)).toEqual(
			[0, 49, 50, 99, 100, 119].map(titleFor).sort()
		);
	});

	it('attributes findings to the right dependency when batches finish out of order', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: unknown, init?: { body?: string }) => {
				// Earlier batches are slower, so results arrive in reverse order.
				const first = parseQueries(init)[0].package.name;
				const batch = Number(first.replace('pkg-', '')) / 50;
				await new Promise((r) => setTimeout(r, (3 - batch) * 30));
				return okBatch(url, init);
			})
		);

		const { execution, findings } = await runOsvDependencyScan([
			{ filename: 'package.json', patch: pkgPatch(150) },
		]);

		expect(execution.status).toBe('success');
		expect(titles(findings)).toEqual(
			[0, 49, 50, 99, 100, 149].map(titleFor).sort()
		);
		for (const f of findings) {
			expect(f.evidence[0].file).toBe('package.json');
		}
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
		expect(findings).toHaveLength(20);
		expect(execution.findings).toBe(20);
		expect(titles(findings)).toContain(titleFor(499));
		expect(titles(findings).join()).not.toContain('pkg-500');
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
		// Batch 2 (pkg-50 to pkg-99) failed; the other two batches are kept.
		expect(titles(findings)).toEqual([0, 49, 100, 119].map(titleFor).sort());
	});

	it('keeps the unqueried count when a long error message is reported', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('x'.repeat(1000));
			})
		);
		const { execution } = await runOsvDependencyScan([
			{ filename: 'package.json', patch: pkgPatch(520) },
		]);
		expect(execution.reason).toContain('20 not queried');
		expect(execution.reason).toContain('10 of 10 OSV.dev batches failed');
		expect((execution.reason ?? '').length).toBeLessThan(400);
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
