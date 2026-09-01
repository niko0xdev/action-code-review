import { appendFileSync, readFileSync } from 'node:fs';
import * as core from '@actions/core';
import { buildFindingBody } from './comments.js';
export const BUFFER_PATH = process.env.AI_INLINE_BUFFER_PATH ?? '/tmp/ai-inline-buffer.jsonl';
const TEST_PROBE_RE = /^(test comment|testing if|can i|does this work|checking if)/i;
function isTestProbe(body) {
    const trimmed = body.trim();
    if (!trimmed)
        return true;
    return TEST_PROBE_RE.test(trimmed);
}
export function appendToBuffer(findings) {
    if (findings.length === 0)
        return;
    const lines = `${findings.map((f) => JSON.stringify(f)).join('\n')}\n`;
    appendFileSync(BUFFER_PATH, lines, 'utf8');
}
export function readBuffer() {
    try {
        const raw = readFileSync(BUFFER_PATH, 'utf8');
        return raw
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    catch {
        return [];
    }
}
export function classifyFindings(findings) {
    const neverPost = findings.filter((f) => f.confirmed === false);
    const candidates = findings.filter((f) => f.confirmed !== false);
    if (neverPost.length > 0) {
        core.info(`[buffer] ${neverPost.length} with confirmed=false — not posting`);
    }
    if (candidates.length === 0)
        return { real: [], probe: neverPost };
    const real = [];
    const probe = [...neverPost];
    for (const f of candidates) {
        const body = `${f.title} ${f.description}`.trim();
        if (isTestProbe(body) || isTestProbe(f.title)) {
            probe.push(f);
        }
        else {
            real.push(f);
        }
    }
    return { real, probe };
}
export async function classifyWithLlm(findings, provider) {
    if (!provider)
        return null;
    if (findings.length === 0)
        return [];
    const prompt = `Classify each finding as REAL review vs TEST/PROBE (tool-check placeholder). TEST/PROBE is generic placeholder not specific to code. Respond ONLY JSON array booleans true=REAL false=TEST.\n\n${findings
        .map((f, i) => `${i + 1}. ${JSON.stringify(`${f.title} — ${f.description}`)}`)
        .join('\n')}`;
    try {
        const res = await provider.complete([{ role: 'user', content: prompt }], {
            temperature: 0,
            maxOutputTokens: 256,
        });
        const match = res.content.match(/\[[\s\S]*\]/);
        if (!match)
            return null;
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed) ||
            parsed.length !== findings.length ||
            !parsed.every((v) => typeof v === 'boolean'))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export async function flushBuffer(octokit, owner, repo, prNumber, headSha, provider) {
    const buffered = readBuffer();
    if (buffered.length === 0)
        return { posted: 0, filtered: 0 };
    const neverPost = buffered.filter((f) => f.confirmed === false);
    const candidates = buffered.filter((f) => f.confirmed !== false);
    if (candidates.length === 0) {
        core.info(`[buffer] ${neverPost.length} confirmed=false — not posting`);
        return { posted: 0, filtered: neverPost.length };
    }
    let verdicts = null;
    if (provider) {
        verdicts = await classifyWithLlm(candidates, provider);
    }
    let toPost;
    let filtered;
    if (verdicts === null) {
        const { real, probe } = classifyFindings(candidates);
        toPost = real;
        filtered = [...neverPost, ...probe.filter((p) => !neverPost.includes(p))];
        if (probe.length > 0 && verdicts === null) {
            // heuristic path already accounted; filtered includes probes
        }
    }
    else {
        toPost = candidates.filter((_, i) => verdicts?.[i] === true);
        filtered = [
            ...neverPost,
            ...candidates.filter((_, i) => verdicts?.[i] === false),
        ];
    }
    if (filtered.length > 0) {
        core.warning(`${filtered.length} buffered finding(s) classified as test/probe — NOT posted`);
    }
    let posted = 0;
    for (const finding of toPost) {
        try {
            await octokit.rest.pulls.createReviewComment({
                owner,
                repo,
                pull_number: prNumber,
                body: buildFindingBody(finding),
                commit_id: headSha,
                path: finding.path,
                line: finding.line,
                side: 'RIGHT',
            });
            posted += 1;
        }
        catch (error) {
            core.warning(`[buffer] failed ${finding.path}:${finding.line}: ${error instanceof Error ? error.message : String(error)}`);
            try {
                await octokit.rest.issues.createComment({
                    owner,
                    repo,
                    issue_number: prNumber,
                    body: `## Review for ${finding.path}\n\n**Line ${finding.line}:** ${buildFindingBody(finding)}`,
                });
                posted += 1;
            }
            catch { }
        }
    }
    return { posted, filtered: filtered.length };
}
//# sourceMappingURL=buffer.js.map