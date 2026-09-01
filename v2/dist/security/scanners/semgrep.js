import { spawn } from 'node:child_process';
import { computeFindingFingerprint } from '../findings/fingerprint.js';
/**
 * Execute Semgrep CLI if installed and parse JSON output.
 * Spec reference: §13.
 */
export async function runSemgrepScanner(repositoryPath, targetFiles) {
    const start = Date.now();
    if (targetFiles.length === 0) {
        return {
            execution: {
                name: 'semgrep',
                status: 'skipped',
                reason: 'No eligible files for Semgrep scan',
                findings: 0,
                durationMs: 0,
            },
            findings: [],
        };
    }
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                try {
                    proc.kill('SIGKILL');
                }
                catch {
                    // Ignore
                }
                resolve({
                    execution: {
                        name: 'semgrep',
                        status: 'failed',
                        reason: 'Semgrep scan timed out after 60s',
                        findings: 0,
                        durationMs: Date.now() - start,
                    },
                    findings: [],
                });
            }
        }, 60_000);
        const args = ['scan', '--json', '--quiet', ...targetFiles];
        const proc = spawn('semgrep', args, {
            cwd: repositoryPath,
            env: { ...process.env, SEMGREP_SEND_METRICS: 'off' },
        });
        proc.stdout?.on('data', (d) => {
            stdout += d.toString();
        });
        proc.stderr?.on('data', (d) => {
            stderr += d.toString();
        });
        proc.on('error', (err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                execution: {
                    name: 'semgrep',
                    status: 'skipped',
                    reason: `Semgrep CLI not available: ${err.message}`,
                    findings: 0,
                    durationMs: Date.now() - start,
                },
                findings: [],
            });
        });
        proc.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            if (code !== 0 && !stdout.trim()) {
                resolve({
                    execution: {
                        name: 'semgrep',
                        status: 'failed',
                        reason: `Semgrep exited with code ${code}: ${stderr.slice(0, 100)}`,
                        findings: 0,
                        durationMs: Date.now() - start,
                    },
                    findings: [],
                });
                return;
            }
            try {
                const data = JSON.parse(stdout);
                const results = Array.isArray(data.results)
                    ? data.results
                    : [];
                const findings = results.map((r) => {
                    const sevMap = {
                        ERROR: 'high',
                        WARNING: 'medium',
                        INFO: 'low',
                    };
                    const severity = sevMap[r.extra.severity] || 'medium';
                    const cwe = Array.isArray(r.extra.metadata?.cwe)
                        ? r.extra.metadata?.cwe[0]
                        : typeof r.extra.metadata?.cwe === 'string'
                            ? r.extra.metadata.cwe
                            : undefined;
                    const owasp = Array.isArray(r.extra.metadata?.owasp)
                        ? r.extra.metadata?.owasp[0]
                        : typeof r.extra.metadata?.owasp === 'string'
                            ? r.extra.metadata.owasp
                            : undefined;
                    return {
                        id: `semgrep-${r.check_id}-${r.path}-${r.start.line}`,
                        fingerprint: computeFindingFingerprint({
                            title: r.check_id,
                            file: r.path,
                            category: 'sast',
                            cwe,
                        }),
                        title: r.check_id.split('.').pop() || r.check_id,
                        severity,
                        confidence: 'high',
                        status: 'candidate',
                        category: 'security',
                        cwe,
                        owasp,
                        file: r.path,
                        startLine: r.start.line,
                        endLine: r.end.line,
                        evidence: [
                            {
                                type: 'scanner',
                                description: r.extra.message,
                                file: r.path,
                                line: r.start.line,
                                source: 'semgrep',
                            },
                        ],
                        exploitability: 'likely',
                        remediation: `Address rule violation reported by Semgrep (${r.check_id}).`,
                        scannerSources: ['semgrep'],
                    };
                });
                resolve({
                    execution: {
                        name: 'semgrep',
                        status: 'success',
                        findings: findings.length,
                        durationMs: Date.now() - start,
                    },
                    findings,
                });
            }
            catch (parseError) {
                resolve({
                    execution: {
                        name: 'semgrep',
                        status: 'failed',
                        reason: `Failed to parse Semgrep output JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                        findings: 0,
                        durationMs: Date.now() - start,
                    },
                    findings: [],
                });
            }
        });
    });
}
//# sourceMappingURL=semgrep.js.map