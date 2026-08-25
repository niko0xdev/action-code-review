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
