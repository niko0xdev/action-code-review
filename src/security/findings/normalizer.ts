import type {
	SecurityConfidence,
	SecurityEvidence,
	SecurityExploitability,
	SecurityFinding,
	SecuritySeverity,
	SecurityStatus,
} from '../types.js';
import { computeFindingFingerprint } from './fingerprint.js';

const VALID_SEVERITIES = new Set<SecuritySeverity>([
	'critical',
	'high',
	'medium',
	'low',
	'info',
]);
const VALID_CONFIDENCES = new Set<SecurityConfidence>([
	'confirmed',
	'high',
	'medium',
	'low',
]);
const VALID_STATUSES = new Set<SecurityStatus>([
	'candidate',
	'validated',
	'rejected',
	'needs_review',
]);
const VALID_EXPLOITABILITIES = new Set<SecurityExploitability>([
	'confirmed',
	'likely',
	'theoretical',
	'unknown',
]);

/**
 * Normalize an untrusted raw object into a validated SecurityFinding.
 * Spec reference: §10.
 */
export function normalizeSecurityFinding(
	raw: unknown,
	repo = '',
	defaultScanner?: string
): SecurityFinding | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;

	const title = typeof obj.title === 'string' ? obj.title.trim() : '';
	if (!title) return null;

	const severityRaw = (
		typeof obj.severity === 'string'
			? obj.severity.toLowerCase().trim()
			: 'medium'
	) as SecuritySeverity;
	const severity: SecuritySeverity = VALID_SEVERITIES.has(severityRaw)
		? severityRaw
		: 'medium';

	const confidenceRaw = (
		typeof obj.confidence === 'string'
			? obj.confidence.toLowerCase().trim()
			: typeof obj.confidence === 'number'
				? obj.confidence >= 0.85
					? 'high'
					: obj.confidence >= 0.6
						? 'medium'
						: 'low'
				: 'medium'
	) as SecurityConfidence;
	const confidence: SecurityConfidence = VALID_CONFIDENCES.has(confidenceRaw)
		? confidenceRaw
		: 'medium';

	const statusRaw = (
		typeof obj.status === 'string'
			? obj.status.toLowerCase().trim()
			: 'candidate'
	) as SecurityStatus;
	const status: SecurityStatus = VALID_STATUSES.has(statusRaw)
		? statusRaw
		: 'candidate';

	const exploitabilityRaw = (
		typeof obj.exploitability === 'string'
			? obj.exploitability.toLowerCase().trim()
			: 'unknown'
	) as SecurityExploitability;
	const exploitability: SecurityExploitability = VALID_EXPLOITABILITIES.has(
		exploitabilityRaw
	)
		? exploitabilityRaw
		: 'unknown';

	const file =
		typeof obj.file === 'string'
			? obj.file.trim().replace(/^[\/.]\//, '')
			: typeof obj.path === 'string'
				? obj.path.trim().replace(/^[\/.]\//, '')
				: undefined;

	const startLine =
		typeof obj.startLine === 'number' &&
		Number.isFinite(obj.startLine) &&
		obj.startLine > 0
			? obj.startLine
			: typeof obj.line === 'number' &&
					Number.isFinite(obj.line) &&
					obj.line > 0
				? obj.line
				: undefined;

	const endLine =
		typeof obj.endLine === 'number' &&
		Number.isFinite(obj.endLine) &&
		obj.endLine > 0
			? obj.endLine
			: startLine;

	const category =
		typeof obj.category === 'string' ? obj.category.trim() : undefined;
	const cwe = typeof obj.cwe === 'string' ? obj.cwe.trim() : undefined;
	const owasp = typeof obj.owasp === 'string' ? obj.owasp.trim() : undefined;
	const source = typeof obj.source === 'string' ? obj.source.trim() : undefined;
	const sink = typeof obj.sink === 'string' ? obj.sink.trim() : undefined;
	const remediation =
		typeof obj.remediation === 'string'
			? obj.remediation.trim()
			: typeof obj.suggestion === 'string'
				? obj.suggestion.trim()
				: undefined;

	const attackPath = Array.isArray(obj.attackPath)
		? obj.attackPath
				.filter((step): step is string => typeof step === 'string')
				.map((step) => step.trim())
		: undefined;

	const evidence: SecurityEvidence[] = [];
	if (Array.isArray(obj.evidence)) {
		for (const ev of obj.evidence) {
			if (ev && typeof ev === 'object') {
				const evObj = ev as Record<string, unknown>;
				if (typeof evObj.description === 'string' && evObj.description.trim()) {
					evidence.push({
						type: (typeof evObj.type === 'string' &&
						[
							'code',
							'scanner',
							'dataflow',
							'test',
							'poc',
							'reasoning',
						].includes(evObj.type)
							? evObj.type
							: 'reasoning') as SecurityEvidence['type'],
						description: evObj.description.trim(),
						file:
							typeof evObj.file === 'string' ? evObj.file.trim() : undefined,
						line: typeof evObj.line === 'number' ? evObj.line : undefined,
						source:
							typeof evObj.source === 'string'
								? evObj.source.trim()
								: undefined,
					});
				}
			} else if (typeof ev === 'string' && ev.trim()) {
				evidence.push({
					type: 'reasoning',
					description: ev.trim(),
				});
			}
		}
	} else if (typeof obj.description === 'string' && obj.description.trim()) {
		evidence.push({
			type: 'reasoning',
			description: obj.description.trim(),
		});
	}

	const scannerSources: string[] = [];
	if (Array.isArray(obj.scannerSources)) {
		for (const s of obj.scannerSources) {
			if (typeof s === 'string' && s.trim()) scannerSources.push(s.trim());
		}
	} else if (defaultScanner) {
		scannerSources.push(defaultScanner);
	}

	const fingerprint =
		typeof obj.fingerprint === 'string' && obj.fingerprint.trim()
			? obj.fingerprint.trim()
			: computeFindingFingerprint(
					{
						title,
						file,
						category,
						cwe,
						source,
						sink,
					},
					repo
				);

	const id =
		typeof obj.id === 'string' && obj.id.trim()
			? obj.id.trim()
			: `sec-${fingerprint.slice(0, 12)}`;

	return {
		id,
		fingerprint,
		title,
		severity,
		confidence,
		status,
		category,
		cwe,
		owasp,
		file,
		startLine,
		endLine,
		source,
		sink,
		attackPath,
		evidence,
		exploitability,
		remediation,
		scannerSources: scannerSources.length > 0 ? scannerSources : undefined,
	};
}
