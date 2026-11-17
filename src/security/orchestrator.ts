import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyPrRisk } from './classifier/risk-classifier.js';
import { PiSecurityEngine } from './engines/pi-security-engine.js';
import { PioliumSecurityEngine } from './engines/piolium-engine.js';
import { findingOccurrenceKey } from './findings/dedupe.js';
import { buildFullAuditReport } from './reporters/audit-reporter.js';
import { buildStickySecuritySummary } from './reporters/sticky-summary.js';
import { generateSarif } from './sarif/sarif-generator.js';
import { runSecurityScanners } from './scanners/scanner-engine.js';
import type {
	RiskLevel,
	SecurityConclusion,
	SecurityContext,
	SecurityEngine,
	SecurityFinding,
	SecurityOptions,
	SecurityResult,
	SecuritySeverity,
} from './types.js';
import { SEVERITY_RANKS } from './types.js';
import { applyQualityGate } from './validators/quality-gate.js';

/**
 * Main security workflow orchestrator.
 * Spec reference: §5.2, §8, §9, §11, §18, §19, §26.
 */
type ManagedSecurityEngine = SecurityEngine & {
	dispose?: () => Promise<void>;
	rejectedConfirmations?: SecurityFinding[];
};

export interface SecurityWorkflowDependencies {
	engine?: ManagedSecurityEngine;
	runScanners?: typeof runSecurityScanners;
}

export async function runSecurityWorkflow(
	context: SecurityContext,
	options: SecurityOptions,
	dependencies: SecurityWorkflowDependencies = {}
): Promise<SecurityResult> {
	const engine: ManagedSecurityEngine =
		dependencies.engine ??
		(options.profile === 'diff'
			? new PiSecurityEngine()
			: new PioliumSecurityEngine());
	try {
		return await runSecurityAssessment(context, options, dependencies, engine);
	} finally {
		await engine.dispose?.();
	}
}

async function runSecurityAssessment(
	context: SecurityContext,
	options: SecurityOptions,
	dependencies: SecurityWorkflowDependencies,
	engine: ManagedSecurityEngine
): Promise<SecurityResult> {
	const startTime = Date.now();
	context.scope = options.profile === 'diff' ? 'diff' : 'audit';

	// 1. Pre-LLM Risk Classification
	const riskClassification = classifyPrRisk(context.changedFiles);
	context.riskClassification = riskClassification;

	// 2. Deterministic Static Scanners
	const scannerResult = await (dependencies.runScanners ?? runSecurityScanners)(
		context
	);
	const scannerCandidates = scannerResult.findings;
	const scannerExecutions = scannerResult.executions;

	// 4. Run Security Reasoning via selected engine
	let engineCandidates: SecurityFinding[] = [];
	let engineStatus: 'success' | 'failed' = 'success';
	try {
		if (options.profile === 'diff') {
			engineCandidates = await engine.diff(context);
		} else {
			engineCandidates = await engine.audit(
				context,
				options.profile === 'deep'
					? 'deep'
					: options.profile === 'lite'
						? 'lite'
						: 'balanced'
			);
		}
	} catch {
		// Static findings remain useful, but a failed reasoning engine is never
		// equivalent to a clean audit and must be visible to policy/reporters.
		engineCandidates = [];
		engineStatus = 'failed';
	}

	const allCandidates = [...scannerCandidates, ...engineCandidates];

	// Validate the complete assessment before publication thresholds or caps.
	const assessed = applyQualityGate(
		allCandidates,
		context,
		'info',
		'medium',
		Number.POSITIVE_INFINITY
	);
	let validatedPool = assessed.validated;
	const rejectedFindings = assessed.rejected;

	// 6. Independent Confirmation Pass if enabled and high-risk findings exist
	let confirmFailed = false;
	if (
		options.confirmFindings &&
		(riskClassification.level === 'high' ||
			riskClassification.level === 'critical_surface')
	) {
		try {
			// Scanner findings with confirmed confidence don't need re-confirmation
			const needsConfirm = (f: SecurityFinding) =>
				(f.severity === 'critical' || f.severity === 'high') &&
				f.confidence !== 'confirmed';
			const llmHighCandidates = validatedPool.filter(needsConfirm);
			if (llmHighCandidates.length > 0) {
				const confirmedHigh = await engine.confirm(
					context,
					structuredClone(llmHighCandidates)
				);
				const candidatesByKey = new Map(
					llmHighCandidates.map((f) => [findingOccurrenceKey(f), f])
				);
				const confirmedByKey = new Map<string, SecurityFinding>();
				if (!Array.isArray(confirmedHigh))
					throw new Error('Invalid security confirmation response');
				for (const confirmed of confirmedHigh) {
					const key = findingOccurrenceKey(confirmed);
					const original = candidatesByKey.get(key);
					if (
						!original ||
						confirmedByKey.has(key) ||
						confirmed.id !== original.id ||
						confirmed.title !== original.title ||
						confirmed.severity !== original.severity ||
						!['confirmed', 'high', 'medium'].includes(confirmed.confidence) ||
						!['candidate', 'validated'].includes(confirmed.status) ||
						!['confirmed', 'likely', 'theoretical', 'unknown'].includes(
							confirmed.exploitability
						) ||
						!Array.isArray(confirmed.evidence) ||
						confirmed.evidence.length === 0 ||
						!confirmed.evidence.every(
							(ev) =>
								ev &&
								typeof ev.description === 'string' &&
								ev.description.trim() &&
								[
									'code',
									'scanner',
									'dataflow',
									'test',
									'poc',
									'reasoning',
								].includes(ev.type)
						)
					) {
						throw new Error(
							'Unknown or repeated security confirmation candidate'
						);
					}
					confirmedByKey.set(key, confirmed);
				}
				const refuted = new Map<string, SecurityFinding>();
				for (const verdict of engine.rejectedConfirmations ?? []) {
					const key = findingOccurrenceKey(verdict);
					const original = candidatesByKey.get(key);
					if (
						!original ||
						refuted.has(key) ||
						confirmedByKey.has(key) ||
						verdict.id !== original.id ||
						verdict.title !== original.title ||
						verdict.severity !== original.severity ||
						verdict.status !== 'rejected' ||
						!Array.isArray(verdict.evidence) ||
						!verdict.evidence.some(
							(evidence) =>
								evidence?.type === 'reasoning' &&
								typeof evidence.description === 'string' &&
								evidence.description.trim()
						)
					) {
						throw new Error('Invalid or overlapping security refutation');
					}
					refuted.set(key, verdict);
				}
				if (confirmedByKey.size + refuted.size !== candidatesByKey.size)
					throw new Error('Security confirmation omitted a candidate');
				// Commit the partition only after every verdict is accounted for.
				rejectedFindings.push(...refuted.values());
				validatedPool = validatedPool.flatMap((finding) => {
					if (!needsConfirm(finding)) return [finding];
					const confirmed = confirmedByKey.get(findingOccurrenceKey(finding));
					return confirmed
						? [
								{
									...finding,
									confidence: confirmed.confidence,
									evidence: [
										...finding.evidence,
										...confirmed.evidence.filter(
											(ev) =>
												!finding.evidence.some(
													(original) =>
														JSON.stringify(original) === JSON.stringify(ev)
												)
										),
									],
									exploitability: confirmed.exploitability,
									remediation: confirmed.remediation,
								},
							]
						: [];
				});
			}
		} catch {
			// Unconfirmed high findings stay published, but the run is incomplete.
			confirmFailed = true;
		}
	}

	// Policy and risk describe every validated occurrence, including hidden ones.
	const overallRisk: RiskLevel = deriveOverallRisk(validatedPool);
	const failThresholdReached = isFailThresholdReached(
		validatedPool,
		options.failOn
	);
	const published = applyQualityGate(
		validatedPool,
		context,
		options.minSeverity,
		'medium',
		options.maxFindings
	);
	const validatedFindings = published.validated;
	rejectedFindings.push(...published.rejected);

	// 9. Build Conclusion
	const incomplete =
		engineStatus === 'failed' ||
		confirmFailed ||
		scannerExecutions.some((s) => s.status === 'failed');
	const conclusion: SecurityConclusion = {
		risk: overallRisk,
		publishedFindings: validatedFindings.length,
		validatedFindings: validatedPool.length,
		rejectedFindings: rejectedFindings.length,
		failThresholdReached,
		scanners: scannerExecutions,
		domains: riskClassification.domains,
		engineStatus,
		incomplete,
	};

	// 10. Generate Summaries & Reports
	const summaryMarkdown = buildStickySecuritySummary({
		risk: overallRisk,
		validatedCount: validatedFindings.length,
		rejectedCount: rejectedFindings.length,
		findings: validatedFindings,
		scanners: scannerExecutions,
		domains: riskClassification.domains,
		incomplete,
		model: options.model,
		durationMs: Date.now() - startTime,
	});

	const reportMarkdown = buildFullAuditReport({
		owner: context.owner,
		repo: context.repo,
		profile: options.profile,
		riskClassification,
		findings: validatedFindings,
		scanners: scannerExecutions,
		durationMs: Date.now() - startTime,
	});

	// 11. Write SARIF and Report artifacts to disk if requested
	let sarifJson: string | undefined;
	let sarifPath: string | undefined;
	let reportPath: string | undefined;

	const outputDir = options.outputDir || context.repositoryPath;

	if (options.generateSarif) {
		sarifJson = generateSarif(validatedFindings);
		sarifPath = join(outputDir, 'nim-security.sarif');
		try {
			await mkdir(outputDir, { recursive: true });
			await writeFile(sarifPath, sarifJson, 'utf8');
		} catch {
			// Non-blocking, but never advertise a file that was not written.
			sarifPath = undefined;
		}
	}

	if (options.profile !== 'diff') {
		reportPath = join(outputDir, 'final-audit-report.md');
		try {
			await mkdir(outputDir, { recursive: true });
			await writeFile(reportPath, reportMarkdown, 'utf8');
		} catch {
			// Non-blocking if disk write fails
		}
	}

	return {
		findings: validatedFindings,
		rejectedFindings,
		conclusion,
		summaryMarkdown,
		sarifJson,
		sarifPath,
		reportMarkdown,
		reportPath,
		riskClassification,
		scanners: scannerExecutions,
	};
}

function deriveOverallRisk(findings: SecurityFinding[]): RiskLevel {
	if (findings.some((f) => f.severity === 'critical')) return 'critical';
	if (findings.some((f) => f.severity === 'high')) return 'high';
	if (findings.some((f) => f.severity === 'medium')) return 'medium';
	if (findings.some((f) => f.severity === 'low')) return 'low';
	return 'none';
}

function isFailThresholdReached(
	findings: SecurityFinding[],
	failOn: SecuritySeverity | 'none'
): boolean {
	if (failOn === 'none') return false;
	const failRank = SEVERITY_RANKS[failOn] ?? 4;
	return findings.some((f) => (SEVERITY_RANKS[f.severity] ?? 0) >= failRank);
}
