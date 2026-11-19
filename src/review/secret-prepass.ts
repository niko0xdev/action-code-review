import { scanSecretsInDiff } from '../security/scanners/secret-scanner.js';
import type { ChangedFile } from '../types/context.js';
import type { Finding, ReviewResult, Severity } from '../types/finding.js';
import { computeCounts, riskFromFindings } from './severity.js';

/** Inline comments one run may add for deterministic secret matches. */
const MAX_SECRET_FINDINGS = 10;

const SEVERITY: Record<string, Severity> = {
	critical: 'critical',
	high: 'high',
	medium: 'medium',
};

/**
 * Run the deterministic secret scanner over every changed file with a patch
 * (independent of `exclude-patterns`: a credential is exposed wherever it is
 * added) and express each match as a review finding. The finding names the
 * rule but never quotes the matched value.
 */
export function scanReviewSecrets(files: readonly ChangedFile[]): Finding[] {
	return scanSecretsInDiff([...files]).flatMap((secret) => {
		if (!secret.file || typeof secret.startLine !== 'number') return [];
		const rule = secret.id.slice(0, secret.id.indexOf(`-${secret.file}-`));
		return [
			{
				severity: SEVERITY[secret.severity] ?? 'low',
				confidence: 1,
				category: 'security',
				path: secret.file,
				line: secret.startLine,
				title: `${secret.title} added in this change`,
				ruleId: `secret-scan/${rule}`,
				description:
					'A credential pattern was found on an added line (deterministic secret scan). Remove it from the change and load it from a secret store or environment variable instead.',
				impact:
					'Anyone who can read the repository or its history can use the credential. Revoke or rotate it, since it is already in the pushed commits.',
			},
		];
	});
}

/**
 * Add secret findings to a review result unless the model already reported a
 * security finding on the same line, then recompute counts and risk.
 */
export function mergeSecretFindings(
	result: ReviewResult,
	secrets: readonly Finding[]
): void {
	// The deterministic match wins on its own line: a model finding there is
	// dropped rather than allowed to hide the credential, so model output can
	// never suppress a scan result.
	const matched = new Set(
		secrets.map((secret) => `${secret.path}:${secret.line}`)
	);
	const kept = result.findings.filter(
		(finding) =>
			!(
				finding.category === 'security' &&
				matched.has(`${finding.path}:${finding.line}`)
			)
	);
	const added = secrets.slice(0, MAX_SECRET_FINDINGS);
	result.findings = [...added, ...kept];
	result.counts = computeCounts(result.findings);
	result.risk = riskFromFindings(result.findings);
	result.diagnostics = {
		...result.diagnostics,
		secretScanFindings: added.length,
	};
}
