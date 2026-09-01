import { redactSecrets } from '../redaction/redactor.js';
/**
 * Render sticky security summary comment for GitHub PR.
 * Spec reference: §16.
 */
export function buildStickySecuritySummary(options) {
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
            return `✓ **${s.name}**: ${s.findings} candidate(s) (${s.durationMs ?? 0}ms)`;
        }
        if (s.status === 'skipped') {
            return `– **${s.name}**: skipped${s.reason ? ` (${s.reason})` : ''}`;
        }
        return `✗ **${s.name}**: failed${s.reason ? ` (${s.reason})` : ''}`;
    });
    const domainLines = options.domains.length
        ? options.domains.map((d) => `• ${d}`).join('\n')
        : '• general';
    const findingTableRows = options.findings.slice(0, 10).map((f) => {
        const loc = f.file
            ? `${f.file}${f.startLine ? `:${f.startLine}` : ''}`
            : 'Repository';
        return `| **${f.severity.toUpperCase()}** | ${f.cwe || 'N/A'} | ${f.title} | \`${loc}\` | ${f.confidence} |`;
    });
    const tableSection = findingTableRows.length > 0
        ? `\n### Validated Findings\n| Severity | CWE | Title | Location | Confidence |\n|---|---|---|---|---|\n${findingTableRows.join('\n')}\n`
        : '\n*No security vulnerabilities identified at or above the publish threshold.*\n';
    const raw = `<!-- nim-security-sticky-summary -->
## 🔐 Nim Security Review

**Risk:** \`${options.risk.toUpperCase()}\`

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
//# sourceMappingURL=sticky-summary.js.map