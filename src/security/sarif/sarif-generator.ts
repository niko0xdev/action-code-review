import { redactSecrets } from '../redaction/redactor.js';
import type { SecurityFinding, SecuritySeverity } from '../types.js';

interface SarifRule {
	id: string;
	name: string;
	shortDescription: { text: string };
	fullDescription?: { text: string };
	defaultConfiguration: {
		level: 'error' | 'warning' | 'note' | 'none';
	};
	helpUri?: string;
	properties?: {
		tags?: string[];
		precision?: string;
	};
}

interface SarifResult {
	ruleId: string;
	level: 'error' | 'warning' | 'note' | 'none';
	message: { text: string; markdown?: string };
	locations?: Array<{
		physicalLocation: {
			artifactLocation: { uri: string; uriBaseId?: string };
			region?: {
				startLine: number;
				endLine?: number;
			};
		};
	}>;
	properties?: {
		fingerprint: string;
		confidence: string;
		exploitability: string;
	};
}

/**
 * Generate valid SARIF v2.1.0 JSON representation from normalized security findings.
 * Spec reference: §18.
 */
export function generateSarif(
	findings: SecurityFinding[],
	toolName = 'action-code-review',
	toolVersion = '2.0.0'
): string {
	const rulesMap = new Map<string, SarifRule>();
	const results: SarifResult[] = [];

	for (const finding of findings) {
		const ruleId = finding.cwe || finding.category || 'SEC-VULN';
		const sarifLevel = mapSeverityToSarifLevel(finding.severity);

		if (!rulesMap.has(ruleId)) {
			const tags: string[] = ['security'];
			if (finding.cwe) tags.push(finding.cwe.toLowerCase());
			if (finding.owasp) tags.push(finding.owasp.toLowerCase());

			rulesMap.set(ruleId, {
				id: ruleId,
				name: finding.title.replace(/[^a-zA-Z0-9_-]/g, '_'),
				shortDescription: { text: redactSecrets(finding.title) },
				fullDescription: {
					text: redactSecrets(
						finding.evidence.map((e) => e.description).join(' ') ||
							finding.title
					),
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
		const messageText = redactSecrets(
			`${finding.title}\n\nEvidence:\n- ${evidenceText}\n\nRemediation:\n${finding.remediation || 'Apply security best practices.'}`
		);

		const result: SarifResult = {
			ruleId,
			level: sarifLevel,
			message: {
				text: messageText,
				markdown: redactSecrets(
					`### ${finding.title}\n\n**Evidence:**\n- ${evidenceText}\n\n**Remediation:**\n${finding.remediation || 'Apply security best practices.'}`
				),
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
		$schema:
			'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
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

function mapSeverityToSarifLevel(
	severity: SecuritySeverity
): 'error' | 'warning' | 'note' | 'none' {
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
