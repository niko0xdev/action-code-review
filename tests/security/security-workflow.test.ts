import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSecurityWorkflow } from '../../src/security/orchestrator.js';
import { scanSecretsInDiff } from '../../src/security/scanners/secret-scanner.js';
import type {
	SecurityContext,
	SecurityEngine,
	SecurityOptions,
} from '../../src/security/types.js';

const engine: SecurityEngine = {
	name: 'deterministic-test-engine',
	diff: async () => [],
	audit: async () => [],
	confirm: async (_context, findings) => findings,
};

describe('SecurityWorkflowIntegration', () => {
	it('runs diff security profile with scanner findings and SARIF generation', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'sec-test-'));

		try {
			const options: SecurityOptions = {
				mode: 'security',
				profile: 'diff',
				minSeverity: 'medium',
				failOn: 'critical',
				confirmFindings: true,
				inlineComments: true,
				stickyComment: true,
				generateSarif: true,
				maxFindings: 10,
				riskThreshold: 'high',
				outputDir: tempDir,
			};

			const context: SecurityContext = {
				repositoryPath: tempDir,
				owner: 'test-org',
				repo: 'test-repo',
				prNumber: 42,
				headSha: 'head1234567890',
				changedFiles: [
					{
						filename: 'src/auth/token.ts',
						status: 'modified',
						additions: 2,
						deletions: 0,
						patch: `@@ -1,2 +1,4 @@
+const adminToken = "ghp_1234567890abcdef1234567890abcdef";
+export function check() {}`,
					},
				],
				options,
			};

			const result = await runSecurityWorkflow(context, options, {
				engine,
				runScanners: async (ctx) => ({
					findings: scanSecretsInDiff(ctx.changedFiles),
					executions: [
						{
							name: 'secret-scan',
							status: 'success',
							findings: scanSecretsInDiff(ctx.changedFiles).length,
						},
					],
				}),
			});

			expect(result.findings.length).toBeGreaterThanOrEqual(1);
			expect(result.conclusion.risk).toBe('critical');
			expect(result.conclusion.failThresholdReached).toBe(true);
			expect(result.sarifPath).toBeDefined();
			expect(result.sarifJson).toContain('2.1.0');
			expect(result.summaryMarkdown).toContain('🔐 Nim Security');
		} finally {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	it('handles clean PR with no findings', async () => {
		const options: SecurityOptions = {
			mode: 'security',
			profile: 'diff',
			minSeverity: 'medium',
			failOn: 'critical',
			confirmFindings: true,
			inlineComments: true,
			stickyComment: true,
			generateSarif: false,
			maxFindings: 10,
			riskThreshold: 'high',
		};

		const context: SecurityContext = {
			repositoryPath: process.cwd(),
			owner: 'test-org',
			repo: 'test-repo',
			prNumber: 10,
			changedFiles: [
				{
					filename: 'README.md',
					status: 'modified',
					additions: 1,
					deletions: 0,
					patch: '+# Updated Readme',
				},
			],
			options,
		};

		const result = await runSecurityWorkflow(context, options, {
			engine,
			runScanners: async (ctx) => ({
				findings: scanSecretsInDiff(ctx.changedFiles),
				executions: [
					{
						name: 'secret-scan',
						status: 'success',
						findings: scanSecretsInDiff(ctx.changedFiles).length,
					},
				],
			}),
		});
		expect(result.findings).toHaveLength(0);
		expect(result.conclusion.risk).toBe('none');
		expect(result.conclusion.incomplete).toBe(false);
		expect(result.conclusion.engineStatus).toBe('success');
		expect(result.conclusion.failThresholdReached).toBe(false);
	});
});
