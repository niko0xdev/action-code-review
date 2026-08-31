import { redactSecrets } from '../redaction/redactor.js';
/**
 * Generate full markdown audit report for repository security audits.
 * Spec reference: §19.
 */
export function buildFullAuditReport(options) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of options.findings) {
        if (f.severity in counts)
            counts[f.severity]++;
    }
    const findingsSections = options.findings.map((f, i) => {
        const evidenceList = f.evidence.map((e) => `- [${e.type}] ${e.description}`);
        const loc = f.file
            ? `${f.file}${f.startLine ? `:${f.startLine}` : ''}`
            : 'N/A';
        return `
### ${i + 1}. ${f.title}

- **Severity:** \`${f.severity.toUpperCase()}\`
- **Confidence:** \`${f.confidence.toUpperCase()}\`
- **Location:** \`${loc}\`
- **CWE / OWASP:** ${f.cwe || 'N/A'} ${f.owasp ? `(${f.owasp})` : ''}
- **Exploitability:** ${f.exploitability}

#### Evidence:
${evidenceList.join('\n') || '- No specific code evidence attached'}

#### Remediation:
${f.remediation || 'Follow secure coding guidelines.'}
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
        .map((s) => `| ${s.name} | ${s.status} | ${s.findings} | ${s.durationMs ?? 0}ms |`)
        .join('\n')}

---

## 4. Validated Security Findings

${findingsSections.join('\n---\n') || '*No security vulnerabilities identified.*'}
`;
    return redactSecrets(raw.trim());
}
//# sourceMappingURL=audit-reporter.js.map