import { computeFindingFingerprint } from '../findings/fingerprint.js';
/**
 * Deterministic supply-chain dependency scanner.
 */
export function scanDependenciesInDiff(changedFiles) {
    const findings = [];
    for (const file of changedFiles) {
        const isPackageJson = file.filename.endsWith('package.json');
        if (!isPackageJson || !file.patch)
            continue;
        const lines = file.patch.split('\n');
        let currentLine = 1;
        for (const rawLine of lines) {
            const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (hunkMatch) {
                currentLine = Number.parseInt(hunkMatch[1], 10);
                continue;
            }
            if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
                const addedContent = rawLine.slice(1);
                // Check for postinstall lifecycle scripts added
                if (/"(preinstall|postinstall|install)"\s*:\s*"(?:curl|wget|bash|sh|node -e|eval)/i.test(addedContent)) {
                    findings.push({
                        id: `dep-script-${file.filename}-${currentLine}`,
                        fingerprint: computeFindingFingerprint({
                            title: 'Suspicious Dependency Lifecycle Script',
                            file: file.filename,
                            category: 'supply-chain',
                            cwe: 'CWE-829',
                        }),
                        title: 'Suspicious Dependency Lifecycle Script',
                        severity: 'high',
                        confidence: 'high',
                        status: 'candidate',
                        category: 'supply-chain',
                        cwe: 'CWE-829',
                        owasp: 'A06:2021-Vulnerable and Outdated Components',
                        file: file.filename,
                        startLine: currentLine,
                        endLine: currentLine,
                        evidence: [
                            {
                                type: 'scanner',
                                description: 'Package manifest includes a lifecycle script executing remote or shell commands on install.',
                                file: file.filename,
                                line: currentLine,
                            },
                        ],
                        exploitability: 'likely',
                        remediation: 'Avoid lifecycle install scripts that fetch or execute arbitrary remote scripts during installation.',
                        scannerSources: ['dependency-scanner'],
                    });
                }
                // Check for wildcard version dependencies
                if (/":\s*"(\*|latest)"/i.test(addedContent)) {
                    findings.push({
                        id: `dep-wildcard-${file.filename}-${currentLine}`,
                        fingerprint: computeFindingFingerprint({
                            title: 'Unpinned Wildcard Dependency Version',
                            file: file.filename,
                            category: 'supply-chain',
                            cwe: 'CWE-1357',
                        }),
                        title: 'Unpinned Wildcard Dependency Version',
                        severity: 'medium',
                        confidence: 'confirmed',
                        status: 'candidate',
                        category: 'supply-chain',
                        cwe: 'CWE-1357',
                        owasp: 'A06:2021-Vulnerable and Outdated Components',
                        file: file.filename,
                        startLine: currentLine,
                        endLine: currentLine,
                        evidence: [
                            {
                                type: 'scanner',
                                description: 'Dependency pinned to "*" or "latest", allowing arbitrary upstream updates without lock verification.',
                                file: file.filename,
                                line: currentLine,
                            },
                        ],
                        exploitability: 'theoretical',
                        remediation: 'Pin specific semver ranges (e.g. ^1.2.3 or exact 1.2.3) and commit package lockfiles.',
                        scannerSources: ['dependency-scanner'],
                    });
                }
                currentLine++;
            }
            else if (!rawLine.startsWith('-')) {
                currentLine++;
            }
        }
    }
    return findings;
}
//# sourceMappingURL=dependency-scanner.js.map