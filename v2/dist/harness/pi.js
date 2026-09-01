import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReviewPrompt, parseHarnessFindings, toReviewResult, } from './harness.js';
export const PI_READONLY_TOOLS = ['read', 'grep', 'find', 'ls'];
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const PI_ARGS_ALLOWLIST = new Set([
    '--max-duration',
    '--model-override',
    '--no-session',
]);
export function parsePiArgs(raw) {
    if (!raw.trim())
        return [];
    const tokens = raw.trim().split(/\s+/);
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.includes(';') ||
            tok.includes('|') ||
            tok.includes('&') ||
            tok.includes('`') ||
            tok.includes('$'))
            continue;
        if (tok.startsWith('--')) {
            const name = tok.split('=')[0];
            if (!PI_ARGS_ALLOWLIST.has(name) && name !== '--model')
                continue;
            out.push(tok);
            if (!tok.includes('=') &&
                i + 1 < tokens.length &&
                !tokens[i + 1].startsWith('-')) {
                out.push(tokens[++i]);
            }
        }
        else if (tok.startsWith('-'))
            continue;
        else
            out.push(tok);
    }
    return out;
}
export function buildPiArgs(repositoryPath, model, provider = 'openai', extraArgs = []) {
    const args = [
        '-p',
        '--mode',
        'json',
        '--no-session',
        // Allow extensions so user-installed skills (and the built-in profile
        // skills the runtime drops at ${PI_CODING_AGENT_DIR}/skills/) are
        // discoverable. Extensions could allow extra tools, so review which
        // ones ship if security posture tightens further.
        '--no-extensions',
        // Skills ARE on now: the runtime copies per-profile SKILL.md files
        // into ${PI_CODING_AGENT_DIR}/skills/<id>/SKILL.md based on the
        // detected profiles. Pi auto-discovers them at startup and progressive-
        // disclosure loads them on demand for matching tasks.
        '--no-prompt-templates',
        // Context files (AGENTS.md, README.md, etc.) are still off — they
        // are repo-controlled and could leak prompt-injection bait into the
        // review call.
        '--no-context-files',
        '--tools',
        PI_READONLY_TOOLS.join(','),
        '--provider',
        provider,
    ];
    if (model)
        args.push('--model', model);
    for (const a of extraArgs) {
        if (a === '--model-override')
            continue;
        if (a.startsWith('--model-override=')) {
            const v = a.slice('--model-override='.length);
            const mi = args.indexOf('--model');
            if (mi !== -1)
                args.splice(mi, 2);
            args.push('--model', v);
            continue;
        }
        if (!args.includes(a))
            args.push(a);
    }
    // Handle --model-override value token following the flag
    for (let i = 0; i < extraArgs.length; i++) {
        if (extraArgs[i] === '--model-override' && extraArgs[i + 1]) {
            const v = extraArgs[i + 1];
            const mi = args.indexOf('--model');
            if (mi !== -1)
                args.splice(mi, 2);
            args.push('--model', v);
        }
    }
    args.push(`Review this pull request in ${repositoryPath}. See instructions.`);
    return args;
}
export function buildPiEnv(configDir, apiKey) {
    return {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        PI_CODING_AGENT_DIR: configDir,
        PI_OFFLINE: process.env.PI_OFFLINE ?? '1',
        ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
        ...(process.env.OPENAI_API_URL
            ? { OPENAI_API_URL: process.env.OPENAI_API_URL }
            : {}),
        ...(process.env.OPENAI_API_MODEL
            ? { OPENAI_API_MODEL: process.env.OPENAI_API_MODEL }
            : {}),
    };
}
export function extractAssistantText(stdout) {
    const texts = [];
    for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{'))
            continue;
        try {
            const event = JSON.parse(trimmed);
            if (event.type === 'message_end' &&
                event.message?.role === 'assistant' &&
                Array.isArray(event.message.content))
                for (const block of event.message.content)
                    if (block?.type === 'text' && typeof block.text === 'string')
                        texts.push(block.text);
        }
        catch {
            /* ignore non-JSON event lines */
        }
    }
    return texts.join('\n');
}
export class PiHarness {
    options;
    name = 'pi';
    constructor(options = {}) {
        this.options = options;
    }
    async review(context) {
        const stdout = await runPi({
            binaryPath: this.options.binaryPath ?? 'pi',
            args: buildPiArgs(context.repositoryPath, this.options.model ?? process.env.OPENAI_API_MODEL, this.options.provider ?? 'openai', parsePiArgs(this.options.piArgs ?? '')),
            cwd: context.repositoryPath,
            configDir: await resolveRuntimeConfigDir(),
            apiKey: this.options.apiKey,
            prompt: buildReviewPrompt(context, this.options.extraRules, {
                includeFullContent: this.options.includeFullContent,
                maxContextChars: this.options.maxContextChars,
                toolFindings: this.options.toolFindings,
            }),
            timeoutMs: this.options.timeoutMs ?? 15 * 60_000,
        });
        return toReviewResult(parseHarnessFindings(extractAssistantText(stdout)), context.diff.files.map((f) => f.filename));
    }
}
async function resolveRuntimeConfigDir() {
    const configDir = process.env.PI_CODING_AGENT_DIR;
    if (configDir)
        return configDir;
    return mkdtemp(join(tmpdir(), 'acr-v2-pi-test-'));
}
function runPi(params) {
    return new Promise((resolve, reject) => {
        const child = spawn(params.binaryPath, params.args, {
            cwd: params.cwd,
            env: buildPiEnv(params.configDir, params.apiKey),
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let killTimer;
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (killTimer)
                clearTimeout(killTimer);
            error ? reject(error) : resolve(stdout);
        };
        const timer = setTimeout(() => {
            if (settled)
                return;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 250);
            finish(new Error(`Pi review process timed out after ${params.timeoutMs}ms`));
        }, params.timeoutMs);
        const killAndFail = (stream) => {
            if (settled)
                return;
            child.kill('SIGKILL');
            finish(new Error(`Pi ${stream} output exceeded ${MAX_OUTPUT_BYTES} byte cap`));
        };
        const append = (current, chunk, stream) => {
            const text = String(chunk);
            if (Buffer.byteLength(current) + Buffer.byteLength(text) >
                MAX_OUTPUT_BYTES) {
                killAndFail(stream);
                return current;
            }
            return current + text;
        };
        child.stdout.on('data', (chunk) => {
            stdout = append(stdout, chunk, 'stdout');
        });
        child.stderr.on('data', (chunk) => {
            stderr = append(stderr, chunk, 'stderr');
        });
        child.stdin.on('error', (error) => finish(new Error(`Failed to write harness prompt: ${error.message}`)));
        child.on('error', (error) => {
            clearTimeout(timer);
            finish(new Error(`Failed to start harness: ${error.message}`));
        });
        child.on('close', (code) => {
            if (settled)
                return;
            if (code !== 0)
                finish(new Error(`Pi review process failed (exit ${code}): ${stderr.slice(-500)}`));
            else
                finish();
        });
        child.stdin.write(params.prompt);
        child.stdin.end();
    });
}
//# sourceMappingURL=pi.js.map