import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSecurityFinding } from '../findings/normalizer.js';
import type { SecurityContext, SecurityFinding } from '../types.js';
import type { SecurityEngine } from './security-engine.js';

/**
 * Piolium Deep Security Audit Engine Adapter.
 * Spec reference: §8, §19.
 */
export class PioliumSecurityEngine implements SecurityEngine {
	readonly name = 'piolium';

	async diff(ctx: SecurityContext): Promise<SecurityFinding[]> {
		return this.audit(ctx, 'lite');
	}

	async audit(
		ctx: SecurityContext,
		profile: 'lite' | 'balanced' | 'deep'
	): Promise<SecurityFinding[]> {
		const tempWorkDir = await mkdtemp(join(tmpdir(), 'piolium-audit-'));
		try {
			// Dynamic import to avoid hard crash if @vigolium/piolium is optional/custom installed
			let pioliumModule: {
				runAudit?: (opts: {
					repositoryPath: string;
					outputDir: string;
					profile: string;
					model?: string;
					apiKey?: string;
					baseUrl?: string;
				}) => Promise<{ findings: unknown[] }>;
			} | null = null;

			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				pioliumModule = (await import('@vigolium/piolium' as string)) as any;
			} catch {
				// Piolium package not installed in environment, fallback to structured audit synthesis
			}

			if (pioliumModule && typeof pioliumModule.runAudit === 'function') {
				const auditRes = await pioliumModule.runAudit({
					repositoryPath: ctx.repositoryPath,
					outputDir: tempWorkDir,
					profile,
					model: ctx.options.model,
					apiKey: ctx.options.apiKey,
					baseUrl: ctx.options.baseUrl,
				});

				const rawFindings = Array.isArray(auditRes?.findings)
					? auditRes.findings
					: [];
				return rawFindings
					.map((f) => normalizeSecurityFinding(f, ctx.repo, 'piolium'))
					.filter((f): f is SecurityFinding => f !== null);
			}

			// Fallback: use PiSecurityEngine for audit if Piolium native CLI is unavailable
			const { PiSecurityEngine } = await import('./pi-security-engine.js');
			const fallbackEngine = new PiSecurityEngine();
			return fallbackEngine.diff(ctx);
		} finally {
			await rm(tempWorkDir, { recursive: true, force: true }).catch(() => {});
		}
	}

	async confirm(
		ctx: SecurityContext,
		findings: SecurityFinding[]
	): Promise<SecurityFinding[]> {
		const { PiSecurityEngine } = await import('./pi-security-engine.js');
		const piEngine = new PiSecurityEngine();
		return piEngine.confirm(ctx, findings);
	}
}
