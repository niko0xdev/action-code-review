/**
 * Core security domain types and schemas for action-code-review.
 * Spec reference: §8, §10, §26.
 */

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SecurityConfidence = 'confirmed' | 'high' | 'medium' | 'low';

export type SecurityStatus =
	| 'candidate'
	| 'validated'
	| 'rejected'
	| 'needs_review';

export type SecurityExploitability =
	| 'confirmed'
	| 'likely'
	| 'theoretical'
	| 'unknown';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export type RiskClassificationLevel =
	| 'low'
	| 'medium'
	| 'high'
	| 'critical_surface';

export type SecurityProfile = 'diff' | 'lite' | 'balanced' | 'deep' | 'confirm';

export type ExecutionMode = 'auto' | 'review' | 'security' | 'agent';

export interface SecurityEvidence {
	type: 'code' | 'scanner' | 'dataflow' | 'test' | 'poc' | 'reasoning';
	description: string;
	file?: string;
	line?: number;
	source?: string;
}

export interface SecurityFinding {
	id: string;
	fingerprint: string;
	title: string;
	severity: SecuritySeverity;
	confidence: SecurityConfidence;
	status: SecurityStatus;
	category?: string;
	cwe?: string;
	owasp?: string;
	file?: string;
	startLine?: number;
	endLine?: number;
	source?: string;
	sink?: string;
	attackPath?: string[];
	evidence: SecurityEvidence[];
	exploitability: SecurityExploitability;
	remediation?: string;
	scannerSources?: string[];
}

export interface RiskClassification {
	level: RiskClassificationLevel;
	reasons: string[];
	domains: string[];
	changedFiles: string[];
}

export interface ScannerExecution {
	name: string;
	status: 'success' | 'skipped' | 'failed';
	reason?: string;
	findings: number;
	durationMs?: number;
}

export interface SecurityConclusion {
	risk: RiskLevel;
	publishedFindings: number;
	validatedFindings: number;
	rejectedFindings: number;
	failThresholdReached: boolean;
	scanners: ScannerExecution[];
	domains: string[];
}

export interface SecurityResult {
	findings: SecurityFinding[];
	rejectedFindings: SecurityFinding[];
	conclusion: SecurityConclusion;
	summaryMarkdown: string;
	sarifJson?: string;
	sarifPath?: string;
	reportMarkdown?: string;
	reportPath?: string;
	riskClassification: RiskClassification;
	scanners: ScannerExecution[];
}

export interface SecurityContext {
	repositoryPath: string;
	owner: string;
	repo: string;
	prNumber?: number;
	baseSha?: string;
	headSha?: string;
	changedFiles: Array<{
		filename: string;
		status: string;
		additions: number;
		deletions: number;
		patch?: string;
	}>;
	riskClassification?: RiskClassification;
	options: SecurityOptions;
}

export interface SecurityOptions {
	mode: ExecutionMode;
	profile: SecurityProfile;
	minSeverity: SecuritySeverity;
	failOn: SecuritySeverity | 'none';
	confirmFindings: boolean;
	inlineComments: boolean;
	stickyComment: boolean;
	generateSarif: boolean;
	maxFindings: number;
	riskThreshold: RiskClassificationLevel;
	githubToken?: string;
	apiKey?: string;
	baseUrl?: string;
	model?: string;
	trackProgress?: boolean;
	piArgs?: string;
	piBinaryPath?: string;
	outputDir?: string;
}

export interface SecurityEngine {
	readonly name: string;
	diff(ctx: SecurityContext): Promise<SecurityFinding[]>;
	audit(
		ctx: SecurityContext,
		profile: 'lite' | 'balanced' | 'deep'
	): Promise<SecurityFinding[]>;
	confirm(
		ctx: SecurityContext,
		findings: SecurityFinding[]
	): Promise<SecurityFinding[]>;
}

export const SEVERITY_RANKS: Record<SecuritySeverity, number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
	info: 0,
};

export const CONFIDENCE_RANKS: Record<SecurityConfidence, number> = {
	confirmed: 3,
	high: 2,
	medium: 1,
	low: 0,
};

export const RISK_LEVEL_ORDER: Record<RiskClassificationLevel, number> = {
	critical_surface: 3,
	high: 2,
	medium: 1,
	low: 0,
};
