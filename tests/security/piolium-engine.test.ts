import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PiSecurityEngine } from '../../src/security/engines/pi-security-engine.js';
import { PioliumSecurityEngine } from '../../src/security/engines/piolium-engine.js';
import { runSecurityWorkflow } from '../../src/security/orchestrator.js';
import type {
	SecurityContext,
	SecurityOptions,
} from '../../src/security/types.js';

function deepOptions(): SecurityOptions {
	return {
		mode: 'security',
		profile: 'deep',
		minSeverity: 'medium',
		failOn: 'critical',
		confirmFindings: false,
		inlineComments: false,
		stickyComment: false,
		generateSarif: false,
		maxFindings: 20,
		riskThreshold: 'high',
	};
}

function context(
	options = deepOptions(),
	repositoryPath = process.cwd()
): SecurityContext {
	return {
		repositoryPath,
		owner: 'acme',
		repo: 'widget',
		changedFiles: [],
		options,
	};
}

describe('PioliumSecurityEngine', () => {
	it('does not silently downgrade a full audit to a diff review', async () => {
		const fallback = vi
			.spyOn(PiSecurityEngine.prototype, 'diff')
			.mockResolvedValue([]);

		try {
			await expect(
				new PioliumSecurityEngine().audit(context(), 'deep')
			).rejects.toThrow('Full repository security audit requires');
			expect(fallback).not.toHaveBeenCalled();
		} finally {
			fallback.mockRestore();
		}
	});

	it('marks the workflow incomplete when the full-audit adapter is unavailable', async () => {
		const fallback = vi
			.spyOn(PiSecurityEngine.prototype, 'diff')
			.mockResolvedValue([]);
		const repositoryPath = await mkdtemp(join(tmpdir(), 'audit-integrity-'));

		try {
			const result = await runSecurityWorkflow(
				context(deepOptions(), repositoryPath),
				deepOptions()
			);
			expect(result.conclusion.engineStatus).toBe('failed');
			expect(result.conclusion.incomplete).toBe(true);
			expect(fallback).not.toHaveBeenCalled();
		} finally {
			fallback.mockRestore();
			await rm(repositoryPath, { recursive: true, force: true });
		}
	});
});
