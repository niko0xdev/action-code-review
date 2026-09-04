import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyPrRisk } from './classifier/risk-classifier.js';
import { PiSecurityEngine } from './engines/pi-security-engine.js';
import { PioliumSecurityEngine } from './engines/piolium-engine.js';
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
export async function runSecurityWorkflow(
	context: SecurityContext,
	options: SecurityOptions
): Promise<SecurityResult> {
	const startTime = Date.now();

	// 1. Pre-LLM Risk Classification
	const riskClassification = classifyPrRisk(context.changedFiles);
	context.riskClassification = riskClassification;

	// 2. Deterministic Static Scanners
	const scannerResult = await runSecurityScanners(context);
	const scannerCandidates = scannerResult.findings;
	const scannerExecutions = scannerResult.executions;

	// 3. Engine selection based on profile
	let engine: SecurityEngine;
	if (options.profile === 'diff') {
		engine = new PiSecurityEngine();
	} else {
		engine = new PioliumSecurityEngine();
	}

	// 4. Run Security Reasoning via selected engine
	let engineCandidates: SecurityFinding[] = [];
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
		// If reasoning engine fails, proceed with static scanner findings
		engineCandidates = [];
	}

	const allCandidates = [...scannerCandidates, ...engineCandidates];

	// 5. Initial Quality Gate filtering
	const gated = applyQualityGate(
		allCandidates,
		context,
		options.minSeverity,
		'medium',
		options.maxFindings
	);

	let validatedFindings = gated.validated;
	const rejectedFindings = gated.rejected;

	// 6. Independent Confirmation Pass if enabled and high-risk findings exist
	if (
		options.confirmFindings &&
		(riskClassification.level === 'high' ||
			riskClassification.level === 'critical_surface')
	) {
		try {
			// Scanner findings with confirmed confidence don't need re-confirmation
			const llmHighCandidates = validatedFindings.filter(
				(f) =>
					(f.severity === 'critical' || f.severity === 'high') &&
					f.confidence !== 'confirmed'
			);
			if (llmHighCandidates.length > 0) {
				const confirmedHigh = await engine.confirm(context, llmHighCandidates);
				const confirmedIds = new Set(confirmedHigh.map((f) => f.id));

				validatedFindings = validatedFindings.filter((f) => {
					if (
						(f.severity === 'critical' || f.severity === 'high') &&
						f.confidence !== 'confirmed'
					) {
						return confirmedIds.has(f.id);
					}
					return true;
				});
			}
		} catch {
			// Maintain validatedFindings if confirmation pass errors
		}
	}

	// 7. Derive overall risk
	const overallRisk: RiskLevel = deriveOverallRisk(validatedFindings);

	// 8. Evaluate fail-on threshold
	const failThresholdReached = isFailThresholdReached(
		validatedFindings,
		options.failOn
	);

	// 9. Build Conclusion
	const conclusion: SecurityConclusion = {
		risk: overallRisk,
		publishedFindings: validatedFindings.length,
		validatedFindings: validatedFindings.length,
		rejectedFindings: rejectedFindings.length,
		failThresholdReached,
		scanners: scannerExecutions,
		domains: riskClassification.domains,
	};

	// 10. Generate Summaries & Reports
	const summaryMarkdown = buildStickySecuritySummary({
		risk: overallRisk,
		validatedCount: validatedFindings.length,
		rejectedCount: rejectedFindings.length,
		findings: validatedFindings,
		scanners: scannerExecutions,
		domains: riskClassification.domains,
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
			// Non-blocking if disk write fails
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
