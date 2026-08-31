import { scanDependenciesInDiff } from './dependency-scanner.js';
import { scanSecretsInDiff } from './secret-scanner.js';
import { runSemgrepScanner } from './semgrep.js';
/**
 * Execute all deterministic security scanners for a security run.
 * Spec reference: §5.2, §13.
 */
export async function runSecurityScanners(context) {
    const allFindings = [];
    const executions = [];
    // 1. Secret Scanner (always runs, fast deterministic regex)
    const secretStart = Date.now();
    try {
        const secretFindings = scanSecretsInDiff(context.changedFiles);
        allFindings.push(...secretFindings);
        executions.push({
            name: 'secret-scan',
            status: 'success',
            findings: secretFindings.length,
            durationMs: Date.now() - secretStart,
        });
    }
    catch (err) {
        executions.push({
            name: 'secret-scan',
            status: 'failed',
            reason: err instanceof Error ? err.message : String(err),
            findings: 0,
            durationMs: Date.now() - secretStart,
        });
    }
    // 2. Dependency / Supply-Chain Scanner
    const depStart = Date.now();
    try {
        const depFindings = scanDependenciesInDiff(context.changedFiles);
        allFindings.push(...depFindings);
        executions.push({
            name: 'dependency-scan',
            status: 'success',
            findings: depFindings.length,
            durationMs: Date.now() - depStart,
        });
    }
    catch (err) {
        executions.push({
            name: 'dependency-scan',
            status: 'failed',
            reason: err instanceof Error ? err.message : String(err),
            findings: 0,
            durationMs: Date.now() - depStart,
        });
    }
    // 3. Semgrep Scanner (runs if binary available)
    const filenames = context.changedFiles.map((f) => f.filename);
    const semgrepRes = await runSemgrepScanner(context.repositoryPath, filenames);
    executions.push(semgrepRes.execution);
    allFindings.push(...semgrepRes.findings);
    // 4. CodeQL (recorded as skipped when not present in environment)
    if (!process.env.CODEQL_ACTION_ENABLED) {
        executions.push({
            name: 'codeql',
            status: 'skipped',
            reason: 'CodeQL not enabled in workflow environment',
            findings: 0,
            durationMs: 0,
        });
    }
    return {
        findings: allFindings,
        executions,
    };
}
//# sourceMappingURL=scanner-engine.js.map