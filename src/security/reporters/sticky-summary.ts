import { redactSecrets } from '../redaction/redactor.js';
import type { ScannerExecution, SecurityFinding } from '../types.js';
import { codeSpan, proseEscape } from './audit-reporter.js';

export interface StickySummaryOptions {
	risk: string;
	validatedCount: number;
	rejectedCount: number;
	findings: SecurityFinding[];
	scanners: ScannerExecution[];
	domains: string[];
	incomplete?: boolean;
	model?: string;
	durationMs?: number;
}

/**
 * Render sticky security summary comment for GitHub PR.
 * Spec reference: §16.
 */
export function buildStickySecuritySummary(
	options: StickySummaryOptions
): string {
	const counts = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		info: 0,
	};

	for (const f of options.findings) {
		if (f.severity in counts) {
			counts[f.severity]++;
		}
	}

	const scannerLines = options.scanners.map((s) => {
		if (s.status === 'success') {
			return `✓ **${proseEscape(s.name)}**: ${s.findings} candidate(s) (${s.durationMs ?? 0}ms)`;
		}
		if (s.status === 'skipped') {
			return `– **${proseEscape(s.name)}**: skipped${s.reason ? ` (${proseEscape(s.reason)})` : ''}`;
		}
		return `✗ **${proseEscape(s.name)}**: failed${s.reason ? ` (${proseEscape(s.reason)})` : ''}`;
	});

	const domainLines = options.domains.length
		? options.domains.map((d) => `• ${proseEscape(d)}`).join('\n')
		: '• general';

	const findingTableRows = options.findings.slice(0, 10).map((f) => {
		const loc = f.file
			? `${f.file}${f.startLine ? `:${f.startLine}` : ''}`
			: 'Repository';
		return `| **${f.severity.toUpperCase()}** | ${proseEscape(f.cwe || 'N/A')} | ${proseEscape(f.title)} | ${codeSpan(loc).replace(/\|/g, '\\|')} | ${f.confidence} |`;
	});

	const tableSection =
		findingTableRows.length > 0
			? `\n### Validated Findings\n| Severity | CWE | Title | Location | Confidence |\n|---|---|---|---|---|\n${findingTableRows.join('\n')}\n`
			: '\n*No security vulnerabilities identified at or above the publish threshold.*\n';

	const statusNotice = options.incomplete
		? '\n> ⚠️ **SECURITY REVIEW INCOMPLETE** — one or more engines failed; do not treat this report as a clean security pass.\n'
		: '';

	const raw = `<!-- nim-security-sticky-summary -->
## 🔐 Nim Security Review

**Risk:** \`${options.risk.toUpperCase()}\`
${statusNotice}

| Status | Count |
|---|---|
| **Validated findings** | ${options.validatedCount} |
| **Rejected candidates** | ${options.rejectedCount} |
| **Critical** | ${counts.critical} |
| **High** | ${counts.high} |
| **Medium** | ${counts.medium} |
| **Low / Info** | ${counts.low + counts.info} |

${tableSection}

<details>
<summary><b>Static Scanners (${options.scanners.length})</b></summary>

${scannerLines.join('\n') || 'None'}

</details>

<details>
<summary><b>Security Domains Reviewed</b></summary>

${domainLines}

</details>
`;

	return redactSecrets(raw.trim());
}
