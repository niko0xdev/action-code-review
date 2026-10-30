import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	SecurityContext,
	SecurityFinding,
	SecurityOptions,
} from '../../src/security/types.js';

const engine = vi.hoisted(() => ({
	findings: [] as unknown[],
	confirmFails: false,
}));

vi.mock('../../src/security/engines/pi-security-engine.js', () => ({
	PiSecurityEngine: class {
		async diff() {
			return engine.findings;
		}
		async confirm(_ctx: unknown, findings: unknown[]) {
			if (engine.confirmFails) throw new Error('confirm exploded');
			return findings;
		}
	},
}));
vi.mock('../../src/security/scanners/scanner-engine.js', () => ({
	runSecurityScanners: async () => ({ findings: [], executions: [] }),
}));

const { runSecurityWorkflow } = await import(
	'../../src/security/orchestrator.js'
);

function finding(
	id: string,
	severity: SecurityFinding['severity']
): SecurityFinding {
	return {
		id,
		fingerprint: `fp-${id}`,
		title: `Finding ${id}`,
		severity,
		confidence: 'high',
		status: 'candidate',
		file: 'src/auth/token.ts',
		startLine: 1,
		evidence: [{ type: 'code', description: 'evidence' }],
		exploitability: 'likely',
	};
}

function run(overrides: Partial<SecurityOptions>, outputDir?: string) {
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
		outputDir,
		...overrides,
	};
	const context: SecurityContext = {
		repositoryPath: process.cwd(),
		owner: 'o',
		repo: 'r',
		prNumber: 1,
		changedFiles: [
			{
				filename: 'src/auth/token.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
			},
		],
		options,
	};
	return runSecurityWorkflow(context, options);
}

afterEach(() => {
	engine.findings = [];
	engine.confirmFails = false;
});

describe('security orchestrator policy', () => {
	it('marks the review incomplete when the confirm pass fails', async () => {
		engine.findings = [finding('a', 'high')];
		engine.confirmFails = true;
		const result = await run({});
		expect(result.conclusion.incomplete).toBe(true);
		expect(result.summaryMarkdown).toMatch(/incomplete/i);
	});

	it('clears sarifPath when the SARIF write fails', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'sarif-'));
		try {
			const outputDir = join(dir, 'ro');
			await mkdir(outputDir);
			await chmod(outputDir, 0o500);
			const result = await run({ generateSarif: true }, outputDir);
			if (process.getuid?.() === 0) return; // root ignores permissions
			expect(result.sarifPath).toBeUndefined();
		} finally {
			await chmod(join(dir, 'ro'), 0o700).catch(() => {});
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('triggers fail-on below min-severity', async () => {
		engine.findings = [finding('a', 'low')];
		const result = await run({ minSeverity: 'high', failOn: 'low' });
		expect(result.findings).toHaveLength(0);
		expect(result.conclusion.failThresholdReached).toBe(true);
	});
});
