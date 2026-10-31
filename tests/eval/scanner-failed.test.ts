import { describe, expect, it, vi } from 'vitest';
import type {
	ScannerExecution,
	SecurityContext,
	SecurityOptions,
} from '../../src/security/types.js';

/**
 * Completion truth for the security engine: a scanner that failed or an
 * engine that threw can never produce a clean, passing security review.
 */

const state = vi.hoisted(() => ({
	executions: [] as unknown[],
	engineFails: false,
}));

vi.mock('../../src/security/engines/pi-security-engine.js', () => ({
	PiSecurityEngine: class {
		async diff() {
			if (state.engineFails) throw new Error('engine exploded');
			return [];
		}
		async confirm(_ctx: unknown, findings: unknown[]) {
			return findings;
		}
	},
}));
vi.mock('../../src/security/scanners/scanner-engine.js', () => ({
	runSecurityScanners: async () => ({
		findings: [],
		executions: state.executions,
	}),
}));

const { runSecurityWorkflow } = await import(
	'../../src/security/orchestrator.js'
);
const { securityFailureMessage } = await import(
	'../../src/security/completion.js'
);

async function run(executions: ScannerExecution[], engineFails = false) {
	state.executions = executions;
	state.engineFails = engineFails;
	const options: SecurityOptions = {
		mode: 'security',
		profile: 'diff',
		minSeverity: 'medium',
		failOn: 'critical',
		confirmFindings: true,
		inlineComments: false,
		stickyComment: true,
		generateSarif: false,
		maxFindings: 10,
		riskThreshold: 'high',
	};
	const context: SecurityContext = {
		repositoryPath: process.cwd(),
		owner: 'o',
		repo: 'r',
		prNumber: 1,
		changedFiles: [
			{
				filename: 'src/app.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
			},
		],
		options,
	};
	return runSecurityWorkflow(context, options);
}

describe('security completion truth', () => {
	it('treats a failed scanner as incomplete, not clean', async () => {
		const result = await run([
			{
				name: 'osv',
				status: 'failed',
				reason: 'OSV.dev returned 503',
				findings: 0,
			},
		]);
		expect(result.conclusion.incomplete).toBe(true);
		expect(result.conclusion.risk).toBe('none');
		expect(result.summaryMarkdown).toMatch(/incomplete/i);
		expect(securityFailureMessage(result.conclusion, 'critical')).toContain(
			'incomplete'
		);
	});

	it('treats a failed reasoning engine as incomplete', async () => {
		const result = await run([], true);
		expect(result.conclusion.engineStatus).toBe('failed');
		expect(result.conclusion.incomplete).toBe(true);
		expect(securityFailureMessage(result.conclusion, 'critical')).toBeDefined();
	});

	it('only a fully successful run is allowed to be clean', async () => {
		const result = await run([{ name: 'osv', status: 'success', findings: 0 }]);
		expect(result.conclusion.incomplete).toBe(false);
		expect(
			securityFailureMessage(result.conclusion, 'critical')
		).toBeUndefined();
	});
});
