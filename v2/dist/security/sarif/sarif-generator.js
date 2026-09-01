import { redactSecrets } from '../redaction/redactor.js';
/**
 * Generate valid SARIF v2.1.0 JSON representation from normalized security findings.
 * Spec reference: §18.
 */
export function generateSarif(findings, toolName = 'action-code-review', toolVersion = '2.0.0') {
    const rulesMap = new Map();
    const results = [];
    for (const finding of findings) {
        const ruleId = finding.cwe || finding.category || 'SEC-VULN';
        const sarifLevel = mapSeverityToSarifLevel(finding.severity);
        if (!rulesMap.has(ruleId)) {
            const tags = ['security'];
            if (finding.cwe)
                tags.push(finding.cwe.toLowerCase());
            if (finding.owasp)
                tags.push(finding.owasp.toLowerCase());
            rulesMap.set(ruleId, {
                id: ruleId,
                name: finding.title.replace(/[^a-zA-Z0-9_-]/g, '_'),
                shortDescription: { text: redactSecrets(finding.title) },
                fullDescription: {
                    text: redactSecrets(finding.evidence.map((e) => e.description).join(' ') ||
                        finding.title),
                },
                defaultConfiguration: { level: sarifLevel },
                helpUri: finding.cwe
                    ? `https://cwe.mitre.org/data/definitions/${finding.cwe.replace('CWE-', '')}.html`
                    : undefined,
                properties: {
                    tags,
                    precision: finding.confidence === 'confirmed' ? 'very-high' : 'high',
                },
            });
        }
        const evidenceText = finding.evidence
            .map((e) => e.description)
            .join('\n- ');
        const messageText = redactSecrets(`${finding.title}\n\nEvidence:\n- ${evidenceText}\n\nRemediation:\n${finding.remediation || 'Apply security best practices.'}`);
        const result = {
            ruleId,
            level: sarifLevel,
            message: {
                text: messageText,
                markdown: redactSecrets(`### ${finding.title}\n\n**Evidence:**\n- ${evidenceText}\n\n**Remediation:**\n${finding.remediation || 'Apply security best practices.'}`),
            },
            properties: {
                fingerprint: finding.fingerprint,
                confidence: finding.confidence,
                exploitability: finding.exploitability,
            },
        };
        if (finding.file) {
            result.locations = [
                {
                    physicalLocation: {
                        artifactLocation: {
                            uri: finding.file,
                            uriBaseId: '%SRCROOT%',
                        },
                        region: finding.startLine
                            ? {
                                startLine: finding.startLine,
                                endLine: finding.endLine || finding.startLine,
                            }
                            : undefined,
                    },
                },
            ];
        }
        results.push(result);
    }
    const sarifObject = {
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
        version: '2.1.0',
        runs: [
            {
                tool: {
                    driver: {
                        name: toolName,
                        version: toolVersion,
                        informationUri: 'https://github.com/niko0xdev/action-code-review',
                        rules: Array.from(rulesMap.values()),
                    },
                },
                results,
            },
        ],
    };
    return JSON.stringify(sarifObject, null, 2);
}
function mapSeverityToSarifLevel(severity) {
    switch (severity) {
        case 'critical':
        case 'high':
            return 'error';
        case 'medium':
            return 'warning';
        case 'low':
        case 'info':
            return 'note';
        default:
            return 'warning';
    }
}
//# sourceMappingURL=sarif-generator.js.map