import { computeFindingFingerprint } from '../findings/fingerprint.js';
import type { SecurityFinding } from '../types.js';

interface SecretRule {
	id: string;
	name: string;
	pattern: RegExp;
	severity: 'critical' | 'high';
	cwe: string;
	/** Optional second check on the matched text, to drop look-alikes. */
	accept?: (match: string) => boolean;
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
		pattern:
			/(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-|admin-)?[a-zA-Z0-9_-]{20,80}/g,
		severity: 'critical',
		cwe: 'CWE-798',
		// Real keys carry a long run that looks random (a digit, or mixed
		// case); a kebab-case name such as `sk-react-loading-spinner` has no
		// such run, and a lower-case word is not a credential.
		accept: (match) =>
			(match.match(/[A-Za-z0-9]{16,}/g) ?? []).some(
				(run) => /\d/.test(run) || (/[a-z]/.test(run) && /[A-Z]/.test(run))
			),
	},
	{
		id: 'sec-rule-aws-key',
		name: 'Exposed AWS Access Key ID',
		pattern:
			/(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
		severity: 'critical',
		cwe: 'CWE-798',
		// The published AWS documentation ids, and only those.
		accept: (match) => !AWS_EXAMPLE_KEYS.has(match),
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
 * The AWS documentation key ids, which are published examples rather than
 * credentials.
 */
const AWS_EXAMPLE_KEYS = new Set([
	'AKIAIOSFODNN7EXAMPLE',
	'AKIAI44QH8DHBEXAMPLE',
	'ASIAIOSFODNN7EXAMPLE',
	'ABIAIOSFODNN7EXAMPLE',
	'ACCAIOSFODNN7EXAMPLE',
]);

/**
 * An added line carrying either marker may silence a match: `secret-scan:
 * allow`, or the detect-secrets convention `pragma: allowlist secret`.
 *
 * The marker sits on a line the pull request author controls, so it may only
 * silence a value that cannot be a real credential: one that names an example,
 * repeats a character, or repeats a short block (a hand-written test value).
 * A real credential is none of those, so it is still reported.
 */
const ALLOW_PRAGMA =
	/secret-scan:[ \t]*allow\b|pragma:[ \t]*allowlist[ \t]+secret\b/i;

const PLACEHOLDER_WORD =
	/example|placeholder|dummy|fake|notreal|not-real|changeme|redacted|sample/i;
const PLACEHOLDER_RUN = /([A-Za-z0-9])\1{7,}/;

/** True when the value cannot be a real credential. */
export function isPlaceholderValue(value: string): boolean {
	if (PLACEHOLDER_WORD.test(value)) return true;
	if (PLACEHOLDER_RUN.test(value)) return true;
	// A short block written twice, as in `A1b2C3d4A1b2C3d4`.
	const seen = new Set<string>();
	for (let i = 0; i + 4 <= value.length; i++) {
		const block = value.slice(i, i + 4);
		if (seen.has(block)) return true;
		seen.add(block);
	}
	return false;
}

/** A private key header is only a credential when key material follows it. */
function hasKeyBody(lines: string[], index: number): boolean {
	for (let i = index + 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || !line.startsWith('+')) continue;
		const body = line.slice(1).replace(/^["']|["'],?$/g, '');
		if (/^[A-Za-z0-9+/]{32,}={0,2}$/.test(body)) return true;
	}
	return false;
}

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

		for (const [index, rawLine] of lines.entries()) {
			// In unified diff: @@ -a,b +c,d @@
			const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (hunkMatch) {
				currentLine = Number.parseInt(hunkMatch[1], 10);
				continue;
			}

			// Only scan added lines in diff ('+')
			if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
				const addedContent = rawLine.slice(1);

				const allowPragma = ALLOW_PRAGMA.test(addedContent);
				for (const rule of SECRET_RULES) {
					rule.pattern.lastIndex = 0;
					for (const match of addedContent.matchAll(rule.pattern)) {
						const value = match[0];
						if (rule.accept && !rule.accept(value)) continue;
						if (allowPragma && isPlaceholderValue(value)) continue;
						if (rule.id === 'sec-rule-private-key' && !hasKeyBody(lines, index))
							continue;
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
							ruleId: rule.id,
						};
						findings.push(finding);
					}
				}
				currentLine++;
			} else if (!rawLine.startsWith('-') && !rawLine.startsWith('\\')) {
				// "\ No newline at end of file" consumes no line.
				currentLine++;
			}
		}
	}

	return findings;
}
