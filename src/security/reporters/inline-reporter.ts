import { redactSecrets } from '../redaction/redactor.js';
import type { SecurityFinding } from '../types.js';
import { proseEscape } from './audit-reporter.js';

/** The marker alphabet the publisher matches; nothing can close the comment early. */
function markerId(fingerprint: string): string {
	return fingerprint.replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Format developer-actionable inline PR comment for a security finding.
 * Spec reference: §17.
 */
export function formatInlineSecurityComment(finding: SecurityFinding): string {
	// Every model-supplied value is escaped so it renders as inert prose: no
	// heading, link, table, mention, raw HTML, or early comment close.
	const cwePart = finding.cwe ? ` · ${proseEscape(finding.cwe)}` : '';
	const owaspPart = finding.owasp ? ` (${proseEscape(finding.owasp)})` : '';
	const header = `**${finding.severity.toUpperCase()}**${cwePart} · **${proseEscape(finding.title)}**${owaspPart}`;

	const evidenceItems = finding.evidence.map(
		(e) => `- ${proseEscape(e.description)}`
	);
	const evidenceBlock =
		evidenceItems.length > 0
			? `**Evidence:**\n${evidenceItems.join('\n')}`
			: '';

	const impactBlock = finding.exploitability
		? `**Impact / Exploitability:** ${finding.exploitability.toUpperCase()}`
		: '';

	const fixBlock = finding.remediation
		? `**Recommended fix:**\n${proseEscape(finding.remediation)}`
		: '';

	const confidenceBlock = `**Confidence:** ${finding.confidence.toUpperCase()}`;

	const body = [
		`<!-- ai-review-id: ${markerId(finding.fingerprint)} -->`,
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
