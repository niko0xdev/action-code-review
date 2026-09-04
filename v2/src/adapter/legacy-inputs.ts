/**
 * Legacy input mapping (docs/v1-interface-contract.md). Every V1 action
 * input maps into engine configuration with identical defaults. Unknown
 * inputs are ignored; missing inputs fall back to the frozen defaults.
 */

import { normalizeBaseUrl } from '../llm/config.js';

export type LegacyAction = 'pr-review' | 'pr-content';

export type LegacyInputs = Record<string, string | undefined>;

export interface PrReviewEngineOptions {
	githubToken: string;
	apiKey: string;
	baseUrl?: string;
	model: string;
	reviewPrompt?: string;
	maxFiles: number;
	excludePatterns: string[];
	includeDirs?: string[];
	autoApproveWhenResolved: boolean;
	minSeverity: string;
	blockOnIssues: boolean;
	includeFullContent: boolean;
	maxContextChars: number;
}

export interface PrContentEngineOptions {
	githubToken: string;
	apiKey: string;
	baseUrl?: string;
	model: string;
	maxTokens: number;
	includeFileList: boolean;
	customInstructions?: string;
	templatePath: string;
}

export interface SecurityEngineOptions {
	githubToken: string;
	apiKey: string;
	baseUrl?: string;
	model: string;
	mode: 'auto' | 'review' | 'security' | 'agent';
	profile: 'diff' | 'lite' | 'balanced' | 'deep' | 'confirm';
	minSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info';
	failOn: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none';
	confirmFindings: boolean;
	inlineComments: boolean;
	stickyComment: boolean;
	generateSarif: boolean;
	maxFindings: number;
	riskThreshold: 'low' | 'medium' | 'high' | 'critical_surface';
	piArgs?: string;
	piBinaryPath?: string;
	trackProgress?: boolean;
}

const SECURITY_DEFAULTS = {
	mode: 'auto',
	profile: 'diff',
	minSeverity: 'medium',
	failOn: 'critical',
	confirmFindings: 'true',
	inlineComments: 'true',
	stickyComment: 'true',
	generateSarif: 'true',
	maxFindings: '20',
	riskThreshold: 'high',
} as const;

const PR_REVIEW_DEFAULTS = {
	openaiModel: 'gpt-4',
	maxFiles: '10',
	excludePatterns: '*.md,*.txt,*.json,*.yml,*.yaml',
	autoApproveWhenResolved: 'false',
	minSeverity: 'critical',
	blockOnIssues: 'true',
	includeFullContent: 'false',
	maxContextChars: '30000',
} as const;

const PR_CONTENT_DEFAULTS = {
	openaiModel: 'gpt-4',
	// ponytail: frozen action.yml default is 1000; 4096 only as retry escape hatch in cli.ts.
	maxTokens: '1000',
	includeFileList: 'true',
	templatePath: '.github/pull_request_template.md',
} as const;

function get(inputs: LegacyInputs, key: string): string | undefined {
	const value = inputs[key];
	return value === '' ? undefined : value;
}

function bool(value: string | undefined, fallback: string): boolean {
	return (value ?? fallback) === 'true';
}

function int(value: string | undefined, fallback: string): number {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) && String(parsed) === (value ?? '').trim()
		? parsed
		: Number.parseInt(fallback, 10);
}

function splitList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

export function mapLegacyInputs(
	action: LegacyAction,
	inputs: LegacyInputs
): PrReviewEngineOptions | (PrContentEngineOptions & { action: 'pr-content' }) {
	if (action === 'pr-content') {
		return mapPrContent(inputs);
	}
	return mapPrReview(inputs);
}

/** Typed wrapper for the pr-review action path. */
export function mapPrReviewInputs(inputs: LegacyInputs): PrReviewEngineOptions {
	return mapPrReview(inputs);
}

/** Typed wrapper for the pr-content action path. */
export function mapPrContentInputs(
	inputs: LegacyInputs
): PrContentEngineOptions & { action: 'pr-content' } {
	return mapPrContent(inputs);
}

/** Typed wrapper for security mode inputs. Spec reference: §4. */
export function mapSecurityInputs(inputs: LegacyInputs): SecurityEngineOptions {
	const rawBaseUrl = get(inputs, 'openai-base-url') || get(inputs, 'base_url');
	const rawMode = (get(inputs, 'mode') ?? SECURITY_DEFAULTS.mode) as
		| 'auto'
		| 'review'
		| 'security'
		| 'agent';
	const rawProfile = (get(inputs, 'security_profile') ??
		get(inputs, 'security-profile') ??
		SECURITY_DEFAULTS.profile) as
		| 'diff'
		| 'lite'
		| 'balanced'
		| 'deep'
		| 'confirm';
	const rawMinSev = (get(inputs, 'security_min_severity') ??
		get(inputs, 'security-min-severity') ??
		get(inputs, 'min-severity') ??
		SECURITY_DEFAULTS.minSeverity) as
		| 'critical'
		| 'high'
		| 'medium'
		| 'low'
		| 'info';
	const rawFailOn = (get(inputs, 'security_fail_on') ??
		get(inputs, 'security-fail-on') ??
		SECURITY_DEFAULTS.failOn) as
		| 'critical'
		| 'high'
		| 'medium'
		| 'low'
		| 'info'
		| 'none';
	const rawRiskThreshold = (get(inputs, 'security_risk_threshold') ??
		get(inputs, 'security-risk-threshold') ??
		SECURITY_DEFAULTS.riskThreshold) as
		| 'low'
		| 'medium'
		| 'high'
		| 'critical_surface';

	return {
		githubToken:
			get(inputs, 'github-token') ?? get(inputs, 'github_token') ?? '',
		apiKey:
			get(inputs, 'openai-api-key') ??
			get(inputs, 'api_key') ??
			get(inputs, 'openai_api_key') ??
			'',
		baseUrl: rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : undefined,
		model:
			get(inputs, 'openai-model') ??
			get(inputs, 'model') ??
			PR_REVIEW_DEFAULTS.openaiModel,
		mode: rawMode,
		profile: rawProfile,
		minSeverity: rawMinSev,
		failOn: rawFailOn,
		confirmFindings: bool(
			get(inputs, 'security_confirm_findings') ??
				get(inputs, 'security-confirm-findings'),
			SECURITY_DEFAULTS.confirmFindings
		),
		inlineComments: bool(
			get(inputs, 'security_inline_comments') ??
				get(inputs, 'security-inline-comments'),
			SECURITY_DEFAULTS.inlineComments
		),
		stickyComment: bool(
			get(inputs, 'security_sticky_comment') ??
				get(inputs, 'security-sticky-comment') ??
				get(inputs, 'sticky-summary'),
			SECURITY_DEFAULTS.stickyComment
		),
		generateSarif: bool(
			get(inputs, 'security_sarif') ?? get(inputs, 'security-sarif'),
			SECURITY_DEFAULTS.generateSarif
		),
		maxFindings: int(
			get(inputs, 'security_max_findings') ??
				get(inputs, 'security-max-findings'),
			SECURITY_DEFAULTS.maxFindings
		),
		riskThreshold: rawRiskThreshold,
		piArgs: get(inputs, 'pi-args') ?? get(inputs, 'pi_args'),
		piBinaryPath:
			get(inputs, 'pi-binary-path') ?? get(inputs, 'pi_binary_path'),
		trackProgress: bool(
			get(inputs, 'track-progress') ?? get(inputs, 'track_progress'),
			'false'
		),
	};
}

function mapPrReview(inputs: LegacyInputs): PrReviewEngineOptions {
	const rawBaseUrl = get(inputs, 'openai-base-url');
	return {
		githubToken: get(inputs, 'github-token') ?? '',
		apiKey: get(inputs, 'openai-api-key') ?? '',
		baseUrl: rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : undefined,
		model: get(inputs, 'openai-model') ?? PR_REVIEW_DEFAULTS.openaiModel,
		reviewPrompt: get(inputs, 'review-prompt'),
		maxFiles: int(get(inputs, 'max-files'), PR_REVIEW_DEFAULTS.maxFiles),
		excludePatterns: splitList(
			get(inputs, 'exclude-patterns') ?? PR_REVIEW_DEFAULTS.excludePatterns
		),
		includeDirs: (() => {
			const dirs = splitList(get(inputs, 'include-dir'));
			return dirs.length > 0 ? dirs : undefined;
		})(),
		autoApproveWhenResolved: bool(
			get(inputs, 'auto-approve-when-resolved'),
			PR_REVIEW_DEFAULTS.autoApproveWhenResolved
		),
		minSeverity: get(inputs, 'min-severity') ?? PR_REVIEW_DEFAULTS.minSeverity,
		blockOnIssues: bool(
			get(inputs, 'block-on-issues'),
			PR_REVIEW_DEFAULTS.blockOnIssues
		),
		includeFullContent: bool(
			get(inputs, 'include-full-content'),
			PR_REVIEW_DEFAULTS.includeFullContent
		),
		maxContextChars: int(
			get(inputs, 'max-context-chars'),
			PR_REVIEW_DEFAULTS.maxContextChars
		),
	};
}

function mapPrContent(
	inputs: LegacyInputs
): PrContentEngineOptions & { action: 'pr-content' } {
	const rawBaseUrl = get(inputs, 'openai-base-url');
	return {
		action: 'pr-content',
		githubToken: get(inputs, 'github-token') ?? '',
		apiKey: get(inputs, 'openai-api-key') ?? '',
		baseUrl: rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : undefined,
		model: get(inputs, 'openai-model') ?? PR_CONTENT_DEFAULTS.openaiModel,
		maxTokens: int(get(inputs, 'max-tokens'), PR_CONTENT_DEFAULTS.maxTokens),
		includeFileList: bool(
			get(inputs, 'include-file-list'),
			PR_CONTENT_DEFAULTS.includeFileList
		),
		customInstructions: get(inputs, 'custom-instructions'),
		templatePath:
			get(inputs, 'template-path') ?? PR_CONTENT_DEFAULTS.templatePath,
	};
}
