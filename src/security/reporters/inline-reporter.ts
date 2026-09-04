import { redactSecrets } from '../redaction/redactor.js';
import type { SecurityFinding } from '../types.js';

/**
 * Format developer-actionable inline PR comment for a security finding.
 * Spec reference: §17.
 */
export function formatInlineSecurityComment(finding: SecurityFinding): string {
	const cwePart = finding.cwe ? ` · ${finding.cwe}` : '';
	const owaspPart = finding.owasp ? ` (${finding.owasp})` : '';
	const header = `**${finding.severity.toUpperCase()}**${cwePart} · **${finding.title}**${owaspPart}`;

	const evidenceItems = finding.evidence.map((e) => `- ${e.description}`);
	const evidenceBlock =
		evidenceItems.length > 0
			? `**Evidence:**\n${evidenceItems.join('\n')}`
			: '';

	const impactBlock = finding.exploitability
		? `**Impact / Exploitability:** ${finding.exploitability.toUpperCase()}`
		: '';

	const fixBlock = finding.remediation
		? `**Recommended fix:**\n${finding.remediation}`
		: '';

	const confidenceBlock = `**Confidence:** ${finding.confidence.toUpperCase()}`;

	const body = [
		`<!-- ai-review-id: ${finding.fingerprint} -->`,
		header,
		'',
		evidenceBlock,
		'',
		impactBlock,
		'',
		fixBlock,
		'',
		confidenceBlock,
	]
		.filter((section) => section !== '')
		.join('\n');

	return redactSecrets(body);
}
