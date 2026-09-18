import { redactSecrets } from '../redaction/redactor.js';
import type {
	RiskClassification,
	ScannerExecution,
	SecurityEvidence,
	SecurityFinding,
} from '../types.js';

/** Unicode line/paragraph separators a renderer may treat as line breaks. */
const LINE_SEPARATORS = String.fromCharCode(0x85, 0x2028, 0x2029);

/**
 * Normalize untrusted value text to a single line so it cannot start a new
 * Markdown block (heading, list, table row, or raw HTML). Collapses CR/LF and
 * the Unicode line/paragraph separators a renderer may also treat as breaks.
 */
function normalizeInline(value: string): string {
	return value
		.replace(/[\r\n]+/g, ' ')
		.replace(new RegExp(`[${LINE_SEPARATORS}]`, 'g'), ' ');
}

/**
 * Escape untrusted prose so a single line cannot open a Markdown block, link,
 * table row, or raw HTML element. Angle brackets become entities; the
 * remaining punctuation is backslash-escaped, which renders as the literal
 * character. A leading unordered or ordered list marker is escaped too, so a
 * value cannot become a list item. The colon is escaped so a bare URL
 * (`https://…`) cannot autolink even without explicit link syntax, and a
 * domain dot or email at-sign is escaped so GFM's bare `www.` and email
 * autolink extensions cannot trigger either. The backslash renders invisibly
 * in a Markdown renderer, so the value still reads as `www.example.com` and
 * `attacker@example.com`.
 */
const PROSE_ESCAPE_PATTERN = /[\\`*_[\]()|#:@]|\.(?=\.?\w)/g;

function proseEscape(value: string): string {
	const escaped = normalizeInline(value)
		.replace(PROSE_ESCAPE_PATTERN, '\\$&')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return escaped.replace(
		/^(\s*)([-+]|\d+\.)(?=\s|$)/,
		(_match, lead, marker) =>
			marker.endsWith('.')
				? `${lead}${marker.slice(0, -1)}\\.`
				: `${lead}\\${marker}`
	);
}

function longestBacktickRun(value: string): number {
	let longest = 0;
	let current = 0;
	for (const char of value) {
		current = char === '`' ? current + 1 : 0;
		if (current > longest) longest = current;
	}
	return longest;
}

/**
 * Render an untrusted value as an inline code span. The fence is always
 * longer than any backtick run inside the value, so the value cannot close
 * the span early and leak Markdown syntax.
 */
function codeSpan(value: string): string {
	const normalized = normalizeInline(value);
	const fence = '`'.repeat(longestBacktickRun(normalized) + 1);
	const padded =
		normalized.startsWith('`') || normalized.endsWith('`')
			? ` ${normalized} `
			: normalized;
	return `${fence}${padded}${fence}`;
}

/** Evidence location from optional file and positive finite line. */
function evidenceLocation(evidence: SecurityEvidence): string | undefined {
	const file = evidence.file?.trim();
	if (!file) return undefined;
	const line = evidence.line;
	if (
		typeof line !== 'number' ||
		!Number.isFinite(line) ||
		!Number.isInteger(line) ||
		line < 1
	) {
		return file;
	}
	return `${file}:${line}`;
}

export interface AuditReportOptions {
	owner: string;
	repo: string;
	profile: string;
	riskClassification: RiskClassification;
	findings: SecurityFinding[];
	scanners: ScannerExecution[];
	durationMs?: number;
}

/**
 * Generate full markdown audit report for repository security audits.
 * Spec reference: §19.
 */
export function buildFullAuditReport(options: AuditReportOptions): string {
	const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
	for (const f of options.findings) {
		if (f.severity in counts) counts[f.severity]++;
	}

	const findingsSections = options.findings.map((f, i) => {
		const evidenceList = f.evidence.map((e) => {
			const location = evidenceLocation(e);
			const prefix = location
				? `- [${e.type}] ${codeSpan(location)} — `
				: `- [${e.type}] `;
			return `${prefix}${proseEscape(e.description)}`;
		});
		const loc = f.file
			? codeSpan(`${f.file}${f.startLine ? `:${f.startLine}` : ''}`)
			: 'N/A';

		const source = f.source?.trim();
		const sink = f.sink?.trim();
		const attackPath = (f.attackPath ?? [])
			.map((step) => step.trim())
			.filter((step) => step.length > 0);

		const contextLines = [
			source ? `- **Source:** ${codeSpan(source)}` : '',
			sink ? `- **Sink:** ${codeSpan(sink)}` : '',
		].filter((line) => line !== '');
		const contextBlock =
			contextLines.length > 0
				? `\n#### Evidence Context:\n${contextLines.join('\n')}\n`
				: '';
		const attackPathBlock =
			attackPath.length > 0
				? `\n#### Attack Path:\n${attackPath
						.map((step, index) => `${index + 1}. ${codeSpan(step)}`)
						.join('\n')}\n`
				: '';

		return `
### ${i + 1}. ${proseEscape(f.title)}

- **Severity:** \`${f.severity.toUpperCase()}\`
- **Confidence:** \`${f.confidence.toUpperCase()}\`
- **Location:** \`${loc}\`
- **CWE / OWASP:** ${proseEscape(f.cwe || 'N/A')}${f.owasp ? ` (${proseEscape(f.owasp)})` : ''}
- **Exploitability:** ${f.exploitability}
${contextBlock}
#### Evidence:
${evidenceList.join('\n') || '- No specific code evidence attached'}
${attackPathBlock}
#### Remediation:
${f.remediation ? proseEscape(f.remediation) : 'Follow secure coding guidelines.'}
`;
	});

	const raw = `
# Security Audit Report — ${options.owner}/${options.repo}

- **Audit Profile:** \`${options.profile}\`
- **Overall Risk Level:** \`${options.riskClassification.level.toUpperCase()}\`
- **Total Validated Findings:** ${options.findings.length}
- **Critical:** ${counts.critical} | **High:** ${counts.high} | **Medium:** ${counts.medium} | **Low / Info:** ${counts.low + counts.info}

---

## 1. Executive Summary

This report contains findings from the automated security audit profile (\`${options.profile}\`).
Static analysis tools, cybersecurity domain heuristics, and Pi reasoning were utilized with strict false-positive gating.

---

## 2. Risk Surface Classification

- **Risk Level:** \`${options.riskClassification.level.toUpperCase()}\`
- **Flagged Domains:** ${options.riskClassification.domains.join(', ') || 'general'}
- **Detection Reasons:**
${options.riskClassification.reasons.map((r) => `  - ${r}`).join('\n') || '  - None'}

---

## 3. Scanner Summary

| Scanner | Status | Findings | Duration |
|---|---|---|---|
${options.scanners
	.map(
		(s) =>
			`| ${s.name} | ${s.status} | ${s.findings} | ${s.durationMs ?? 0}ms |`
	)
	.join('\n')}

---

## 4. Validated Security Findings

${findingsSections.join('\n---\n') || '*No security vulnerabilities identified.*'}
`;

	return redactSecrets(raw.trim());
}
