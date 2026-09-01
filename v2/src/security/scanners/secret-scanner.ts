import { computeFindingFingerprint } from '../findings/fingerprint.js';
import type { SecurityFinding } from '../types.js';

interface SecretRule {
	id: string;
	name: string;
	pattern: RegExp;
	severity: 'critical' | 'high';
	cwe: string;
}

const SECRET_RULES: SecretRule[] = [
	{
		id: 'sec-rule-gh-token',
		name: 'Exposed GitHub Token',
		pattern: /(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{16,255}/g,
		severity: 'critical',
		cwe: 'CWE-798',
	},
	{
		id: 'sec-rule-openai-key',
		name: 'Exposed OpenAI API Key',
		pattern: /sk-(?:proj-|svcacct-|admin-)?[a-zA-Z0-9_-]{20,80}/g,
		severity: 'critical',
		cwe: 'CWE-798',
	},
	{
		id: 'sec-rule-aws-key',
		name: 'Exposed AWS Access Key ID',
		pattern:
			/(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
		severity: 'critical',
		cwe: 'CWE-798',
	},
	{
		id: 'sec-rule-private-key',
		name: 'Exposed Private Key',
		pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
		severity: 'critical',
		cwe: 'CWE-312',
	},
	{
		id: 'sec-rule-slack-token',
		name: 'Exposed Slack Token',
		pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
		severity: 'high',
		cwe: 'CWE-798',
	},
];

/**
 * Deterministic secret scanner over diff patches.
 */
export function scanSecretsInDiff(
	changedFiles: Array<{ filename: string; patch?: string }>
): SecurityFinding[] {
	const findings: SecurityFinding[] = [];

	for (const file of changedFiles) {
		if (!file.patch) continue;
		const lines = file.patch.split('\n');
		let currentLine = 1;

		for (const rawLine of lines) {
			// In unified diff: @@ -a,b +c,d @@
			const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (hunkMatch) {
				currentLine = Number.parseInt(hunkMatch[1], 10);
				continue;
			}

			// Only scan added lines in diff ('+')
			if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
				const addedContent = rawLine.slice(1);

				for (const rule of SECRET_RULES) {
					rule.pattern.lastIndex = 0;
					if (rule.pattern.test(addedContent)) {
						const finding: SecurityFinding = {
							id: `${rule.id}-${file.filename}-${currentLine}`,
							fingerprint: computeFindingFingerprint({
								title: rule.name,
								file: file.filename,
								category: 'secrets',
								cwe: rule.cwe,
							}),
							title: rule.name,
							severity: rule.severity,
							confidence: 'confirmed',
							status: 'candidate',
							category: 'security',
							cwe: rule.cwe,
							owasp: 'A07:2021-Identification and Authentication Failures',
							file: file.filename,
							startLine: currentLine,
							endLine: currentLine,
							evidence: [
								{
									type: 'scanner',
									description: `Pattern match for ${rule.name} found in added code.`,
									file: file.filename,
									line: currentLine,
								},
							],
							exploitability: 'confirmed',
							remediation:
								'Remove hardcoded credential immediately and revoke/rotate any compromised tokens.',
							scannerSources: ['secret-scanner'],
						};
						findings.push(finding);
					}
				}
				currentLine++;
			} else if (!rawLine.startsWith('-')) {
				currentLine++;
			}
		}
	}

	return findings;
}
