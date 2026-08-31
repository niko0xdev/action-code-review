/**
 * PreLint orchestrator (V3 Phase 2).
 *
 * Runs deterministic static-analysis tools (biome, ruff, mypy, swiftlint,
 * ktlint, sqlfluff, semgrep) against the checked-out repository and
 * surfaces their findings as structured `ToolFinding` records. These are
 * NOT published as PR comments directly - they are injected into the LLM
 * review prompt as evidence so the model can confirm, contradict, or
 * extend them with higher-level reasoning.
 *
 * Design decisions (docs/v3-decisions.md):
 * - Q1: bundle biome + ruff, graceful skip for the rest
 * - Q3: toolFindings exposed in summary via collapsible section
 * - Q5: SQL detection already partially handled in Phase 1; this module
 *       trusts the SQL profile to detect SQL files
 *
 * The orchestrator is opt-in via `AI_REVIEW_ENABLE_PRELINT=true` env var
 * (cannot add a new action input - V1 contract is frozen).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const PRELINT_TIMEOUT_MS = 60_000;
const MAX_FINDINGS_PER_TOOL = 100;
export function findBinary(repositoryPath, binary) {
    const candidates = [
        join(repositoryPath, 'node_modules', '.bin', binary),
        join(repositoryPath, 'node_modules', '.bin', `${binary}.cmd`),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate))
            return candidate;
    }
    return null;
}
function spawnCollect(cmd, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: options.cwd,
            timeout: options.timeoutMs,
            stdio: ['ignore', 'pipe', 'pipe'],
            killSignal: 'SIGKILL',
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (cb) => {
            if (settled)
                return;
            settled = true;
            cb();
        };
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(() => reject(new Error(`${cmd} timed out after ${options.timeoutMs}ms`)));
        }, options.timeoutMs);
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            finish(() => reject(err));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            finish(() => resolve({ stdout, stderr, code: code ?? 0 }));
        });
    });
}
const biomeRunner = {
    id: 'biome',
    isAvailable: (repo) => findBinary(repo, 'biome') !== null,
    matches: (file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file.filename) &&
        !file.filename.includes('node_modules/'),
    run: async ({ repositoryPath, files, timeoutMs }) => {
        const binary = findBinary(repositoryPath, 'biome');
        if (!binary)
            return [];
        const fileList = files.map((f) => f.filename);
        const { stdout } = await spawnCollect(binary, ['lint', '--reporter=json', '--max-diagnostics=50', ...fileList], { cwd: repositoryPath, timeoutMs });
        return parseBiomeOutput(stdout);
    },
};
const ruffRunner = {
    id: 'ruff',
    isAvailable: (repo) => findBinary(repo, 'ruff') !== null,
    matches: (file) => /\.py$/i.test(file.filename),
    run: async ({ repositoryPath, files, timeoutMs }) => {
        const binary = findBinary(repositoryPath, 'ruff');
        if (!binary)
            return [];
        const fileList = files.map((f) => f.filename);
        const { stdout } = await spawnCollect(binary, ['check', '--output-format=json', '--no-fix', ...fileList], { cwd: repositoryPath, timeoutMs });
        return parseRuffOutput(stdout);
    },
};
/**
 * Swiftlint runner (Phase 4). Swiftlint emits JSON via `--reporter=json`.
 * Graceful skip when binary missing (per ADR Q1: heavy binary, many
 * consumers install it themselves).
 */
const swiftlintRunner = {
    id: 'swiftlint',
    isAvailable: (repo) => findBinary(repo, 'swiftlint') !== null,
    matches: (file) => /\.swift$/i.test(file.filename),
    run: async ({ repositoryPath, files, timeoutMs }) => {
        const binary = findBinary(repositoryPath, 'swiftlint');
        if (!binary)
            return [];
        const fileList = files.map((f) => f.filename);
        const { stdout } = await spawnCollect(binary, ['lint', '--reporter=json', '--quiet', ...fileList], { cwd: repositoryPath, timeoutMs });
        return parseSwiftlintOutput(stdout);
    },
};
/**
 * Ktlint runner (Phase 4). Ktlint 1.x supports `--reporter=json` for
 * machine-readable output. Older 0.x does not - the parser tolerates
 * either format and falls back to skipping the file if the JSON shape
 * is unexpected. Graceful skip when binary missing.
 */
const ktlintRunner = {
    id: 'ktlint',
    isAvailable: (repo) => findBinary(repo, 'ktlint') !== null,
    matches: (file) => /\.(kt|kts)$/i.test(file.filename) && !file.filename.includes('/build/'),
    run: async ({ repositoryPath, files, timeoutMs }) => {
        const binary = findBinary(repositoryPath, 'ktlint');
        if (!binary)
            return [];
        const fileList = files.map((f) => f.filename);
        const { stdout } = await spawnCollect(binary, ['--reporter=json', ...fileList], { cwd: repositoryPath, timeoutMs });
        return parseKtlintOutput(stdout, fileList);
    },
};
/**
 * Sqlfluff runner (Phase 4). Emits JSON via `--format=json`. The CLI
 * exits non-zero when violations are found, so we ignore the exit code
 * and parse stdout regardless. Graceful skip when binary missing.
 */
const sqlfluffRunner = {
    id: 'sqlfluff',
    isAvailable: (repo) => findBinary(repo, 'sqlfluff') !== null,
    matches: (file) => /\.sql$/i.test(file.filename),
    run: async ({ repositoryPath, files, timeoutMs }) => {
        const binary = findBinary(repositoryPath, 'sqlfluff');
        if (!binary)
            return [];
        const fileList = files.map((f) => f.filename);
        // sqlfluff returns non-zero on violations; we want the JSON anyway.
        const { stdout } = await spawnCollect(binary, ['lint', '--format=json', '--disable-progress-bar', ...fileList], { cwd: repositoryPath, timeoutMs });
        return parseSqlfluffOutput(stdout);
    },
};
function parseBiomeOutput(stdout) {
    let parsed = null;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    const diagnostics = Array.isArray(parsed)
        ? parsed
        : (parsed?.diagnostics ?? []);
    const findings = [];
    for (const d of diagnostics) {
        const filename = d.filename ?? d.location?.path ?? '<unknown>';
        const spanStart = d.location?.span?.[0];
        const line = typeof spanStart === 'number' && spanStart > 0 ? spanStart : 1;
        const severity = mapBiomeSeverity(d.severity);
        const code = d.category ?? 'biome';
        const message = d.description ??
            d.message?.map((m) => m.desc ?? '').join(' ') ??
            '(no message)';
        findings.push({
            tool: 'biome',
            code,
            path: filename,
            line,
            severity,
            message,
        });
        if (findings.length >= MAX_FINDINGS_PER_TOOL)
            break;
    }
    return findings;
}
function mapBiomeSeverity(sev) {
    switch (sev) {
        case 'error':
            return 'high';
        case 'warning':
            return 'medium';
        case 'info':
            return 'low';
        default:
            return 'low';
    }
}
function parseRuffOutput(stdout) {
    let parsed = null;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const findings = [];
    for (const d of parsed) {
        const filename = d.filename ?? '<unknown>';
        const line = d.location?.row ?? 1;
        const code = d.code ?? 'ruff';
        const severity = mapRuffSeverity(d.severity);
        findings.push({
            tool: 'ruff',
            code,
            path: filename,
            line,
            severity,
            message: d.message ?? '(no message)',
            docUrl: d.url,
        });
        if (findings.length >= MAX_FINDINGS_PER_TOOL)
            break;
    }
    return findings;
}
function mapRuffSeverity(sev) {
    switch (sev) {
        case 'error':
            return 'high';
        case 'warn':
        case 'warning':
            return 'medium';
        case 'info':
            return 'low';
        default:
            return 'low';
    }
}
function parseSwiftlintOutput(stdout) {
    let parsed = null;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const findings = [];
    for (const d of parsed) {
        const filename = d.file ?? '<unknown>';
        const line = typeof d.line === 'number' && d.line > 0 ? d.line : 1;
        const code = d.rule_id ?? d.type ?? 'swiftlint';
        const severity = mapSwiftlintSeverity(d.severity);
        findings.push({
            tool: 'swiftlint',
            code,
            path: filename,
            line,
            severity,
            message: d.reason ?? '(no message)',
        });
        if (findings.length >= MAX_FINDINGS_PER_TOOL)
            break;
    }
    return findings;
}
function mapSwiftlintSeverity(sev) {
    switch (sev) {
        case 'error':
            return 'high';
        case 'warning':
            return 'medium';
        default:
            return 'low';
    }
}
function parseKtlintOutput(stdout, fileList) {
    let parsed = null;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    if (!parsed)
        return [];
    const reports = Array.isArray(parsed) ? parsed : [parsed];
    const findings = [];
    const fileFallback = fileList[0] ?? '<unknown>';
    for (const report of reports) {
        const filename = report.filepath ?? fileFallback;
        const violations = report.violations ?? [];
        for (const v of violations) {
            const line = typeof v.line === 'number' && v.line > 0 ? v.line : 1;
            findings.push({
                tool: 'ktlint',
                code: v.rule ?? 'ktlint',
                path: filename,
                line,
                severity: 'medium',
                message: v.message ?? '(no message)',
            });
            if (findings.length >= MAX_FINDINGS_PER_TOOL)
                break;
        }
        if (findings.length >= MAX_FINDINGS_PER_TOOL)
            break;
    }
    return findings;
}
function parseSqlfluffOutput(stdout) {
    let parsed = null;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    const files = parsed?.files ?? [];
    const findings = [];
    for (const file of files) {
        const filename = file.filepath ?? '<unknown>';
        const violations = file.violations ?? [];
        for (const v of violations) {
            const line = typeof v.line_no === 'number' && v.line_no > 0 ? v.line_no : 1;
            findings.push({
                tool: 'sqlfluff',
                code: v.code ?? 'sqlfluff',
                path: filename,
                line,
                severity: mapSqlfluffSeverity(v.severity),
                message: v.description ?? '(no message)',
            });
            if (findings.length >= MAX_FINDINGS_PER_TOOL)
                break;
        }
        if (findings.length >= MAX_FINDINGS_PER_TOOL)
            break;
    }
    return findings;
}
function mapSqlfluffSeverity(sev) {
    switch (sev?.toLowerCase()) {
        case 'error':
            return 'high';
        case 'warning':
        case 'warn':
            return 'medium';
        default:
            return 'low';
    }
}
export function defaultTools() {
    return [
        biomeRunner,
        ruffRunner,
        swiftlintRunner,
        ktlintRunner,
        sqlfluffRunner,
    ];
}
export async function runPrelint(options) {
    const timeoutMs = options.timeoutMs ?? PRELINT_TIMEOUT_MS;
    const tools = options.tools ?? defaultTools();
    const findings = [];
    const ran = [];
    const skipped = [];
    for (const tool of tools) {
        if (!tool.isAvailable(options.repositoryPath)) {
            skipped.push(`${tool.id} (binary not found)`);
            continue;
        }
        const matchingFiles = options.changedFiles.filter((f) => tool.matches(f));
        if (matchingFiles.length === 0) {
            skipped.push(`${tool.id} (no matching files)`);
            continue;
        }
        try {
            const toolFindings = await tool.run({
                repositoryPath: options.repositoryPath,
                files: matchingFiles,
                timeoutMs,
            });
            findings.push(...toolFindings);
            ran.push(tool.id);
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            skipped.push(`${tool.id} (${reason})`);
        }
    }
    return { findings, ran, skipped };
}
export function renderToolFindingsForPrompt(findings, maxLines = 50) {
    if (findings.length === 0)
        return '(no static-analyzer findings)';
    const lines = ['Static-analyzer findings (treat as evidence):'];
    for (const finding of findings.slice(0, maxLines)) {
        lines.push(`- [${finding.tool}/${finding.code}] ${finding.path}:${finding.line} (${finding.severity}) ${finding.message}`);
    }
    if (findings.length > maxLines) {
        lines.push(`... and ${findings.length - maxLines} more findings`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=prelint.js.map