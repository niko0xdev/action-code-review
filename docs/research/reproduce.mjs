// Local witnesses for the audited snapshot, not a quality benchmark.
// Run: node docs/research/reproduce.mjs > docs/research/reproduction-results.json
// To assert the historical pre-fix behavior, set ACR_ASSERT_BASELINE=true.
// No network calls, real credentials, or GitHub writes.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = await mkdtemp(join(tmpdir(), 'acr-research-'));
const results = [];
const assertBaseline = process.env.ACR_ASSERT_BASELINE === 'true';
const originalBuffer = process.env.AI_INLINE_BUFFER_PATH;
const originalConfig = process.env.PI_CODING_AGENT_DIR;
const originalFetch = globalThis.fetch;
async function compile(directory) {
  for (const entry of await readdir(join(root, 'src', directory), { withFileTypes: true })) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) { await compile(relative); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const source = await readFile(join(root, 'src', relative), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
    }}).outputText;
    const destination = join(scratch, 'src', relative.replace(/\.ts$/, '.js'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, output);
  }
}
function witness(id, observed, condition) {
  if (assertBaseline) assert.ok(condition, `Snapshot changed or witness failed: ${id}`);
  results.push({ id, reproduced: Boolean(condition), observed });
}
try {
  await compile('');
  await writeFile(join(scratch, 'package.json'), '{"type":"module"}');
  await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  process.env.AI_INLINE_BUFFER_PATH = join(scratch, 'buffer.jsonl');
  process.env.PI_CODING_AGENT_DIR = scratch;
  const load = (file) => import(pathToFileURL(join(scratch, 'src', file)).href);
  const { applyVerifyPass } = await load('review/verify.js');
  const { buildFindingBody, buildSummaryBody } = await load('github/comments.js');
  const { buildAgentDebugSection, buildPiArgs, parsePiArgs, extractAssistantText, PiHarness } = await load('harness/pi.js');
  const { parseHarnessFindings, buildReviewPrompt } = await load('harness/harness.js');
  const { runReview } = await load('review/reviewer.js');
  const { resolveCrossFindingConflicts } = await load('review/validation.js');
  const { normalizeSecurityFinding } = await load('security/findings/normalizer.js');
  const { applyQualityGate } = await load('security/validators/quality-gate.js');
  const { publishSecurityReview } = await load('security/reporters/security-publisher.js');
  const { runSecurityWorkflow } = await load('security/orchestrator.js');
  const { fetchPrContext } = await load('context/pr.js');
  const { OpenAiCompatibleProvider } = await load('llm/openai-compatible.js');
  const { findBinary } = await load('context/prelint.js');
  const { BUILT_IN_SKILLS } = await load('skills/registry.js');
  const finding = { severity: 'critical', confidence: 0.95, category: 'correctness',
    path: 'a.ts', line: 1, title: 'Real defect', description: 'Concrete defect', impact: 'Data lost' };
  const empty = () => ({ findings: [], counts: { critical: 0, high: 0, medium: 0, low: 0 },
    filesReviewed: ['a.ts'], risk: 'none', summary: '' });
  const result = { ...empty(), findings: [finding], risk: 'critical', counts: { critical: 1, high: 0, medium: 0, low: 0 }};
  await applyVerifyPass(result, { toolFindings: [], title: 'PR', body: '', verify: async () => 'not json' });
  witness('F03', { remaining: result.findings.length, risk: result.risk, dropped: result.diagnostics.verifyDropped },
    result.findings.length === 0 && result.risk === 'none');
  const partial = buildSummaryBody({ ...empty(), filesReviewed: [], diagnostics: { failedGroups: 1 }});
  witness('F04', { approvedBanner: partial.includes('**APPROVED**'), failedGroupsVisible: partial.includes('failedGroups') },
    partial.includes('**APPROVED**') && !partial.includes('failedGroups'));
  const code = buildFindingBody({ ...finding, replacement: 'return a < b && c > d;' });
  witness('F05', { entityEscapedSuggestion: code.includes('return a &lt; b &amp;&amp; c &gt; d;') },
    code.includes('return a &lt; b &amp;&amp; c &gt; d;'));
  const testToken = 'ghp_' + 'SYNTHETIC_ONLY_12345678901234567890';
  witness('F06', { inlineLeaksSyntheticToken: buildFindingBody({ ...finding, description: testToken }).includes(testToken),
    debugLeaksSyntheticToken: buildAgentDebugSection([{ stdout: testToken, stderr: '' }]).includes(testToken) },
    buildFindingBody({ ...finding, description: testToken }).includes(testToken));
  const context = { repository: { owner: 'o', repo: 'r' }, pullRequest: { number: 1, title: 'PR', body: '',
    headSha: 'head', baseSha: 'base', headRef: 'feat', baseRef: 'main', author: 'alice', draft: false },
    repositoryPath: scratch, profiles: [{ id: 'typescript', evidence: ['fixture'] }],
    diff: { files: [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, changes: 2, patch: '@@ -1 +1 @@\n-old\n+new' }], totalAdditions: 1, totalDeletions: 1 }};
  const capturedPrompt = join(scratch, 'prompt.txt');
  const fakePi = join(scratch, 'fake-pi.mjs');
  await writeFile(fakePi, `#!/usr/bin/env node\nimport fs from 'node:fs';\nlet text=''; for await (const chunk of process.stdin) text+=chunk; fs.writeFileSync(${JSON.stringify(capturedPrompt)},text); console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'{"findings":[],"summary":"fixture","risk":"none"}'}]}}));`, { mode: 0o700 });
  await runReview(context, new PiHarness({ binaryPath: fakePi, extraRules: 'HARNESS_RULE' }), { extraRules: 'CUSTOM_USER_RULE' });
  const prompt = await readFile(capturedPrompt, 'utf8');
  witness('F07', { harnessRulePresent: prompt.includes('HARNESS_RULE'), customRulePresent: prompt.includes('CUSTOM_USER_RULE') },
    prompt.includes('HARNESS_RULE') && !prompt.includes('CUSTOM_USER_RULE'));
  const noExtensions = buildPiArgs(scratch).includes('--no-extensions');
  witness('F01-static', { noExtensions, noSkills: buildPiArgs(scratch).includes('--no-skills') }, !noExtensions);
  const probe = normalizeSecurityFinding({ title: 'Invented', severity: 'high', confidence: 'high',
    file: 'a.ts', startLine: 999999, endLine: 2, evidence: ['unsupported assertion'] });
  const gated = applyQualityGate([probe], { repositoryPath: scratch, scope: 'diff', changedFiles: [{ filename: 'a.ts' }] });
  witness('F09', { validated: gated.validated.length, invalidRange: [probe.startLine, probe.endLine] }, gated.validated.length === 1);
  const conflicts = resolveCrossFindingConflicts([
    { ...finding, severity: 'high', title: 'Add tenant filter', description: 'Missing tenant filter', confidence: 0.95 },
    { ...finding, severity: 'high', line: 2, title: 'Remove hardcoded admin bypass', description: 'Remove authorization bypass', confidence: 0.9 },
  ]);
  witness('F10', { distinctDefectsRetained: conflicts.findings.length }, conflicts.findings.length === 1);
  const events = ['{"findings":[],"summary":"first"}', '{"findings":[],"summary":"final"}'].map(text =>
    JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } })).join('\n');
  let parseFailed = false; try { parseHarnessFindings(extractAssistantText(events)); } catch { parseFailed = true; }
  witness('F11', { multipleAssistantJsonFails: parseFailed }, parseFailed);
  let malformedFindingsAcceptedAsEmpty = false;
  try {
    const malformed = parseHarnessFindings('{"summary":"ok","findings":"invalid"}');
    malformedFindingsAcceptedAsEmpty = malformed.findings.length === 0;
  } catch {
    malformedFindingsAcceptedAsEmpty = false;
  }
  witness('F12', { malformedFindingsAcceptedAsEmpty }, malformedFindingsAcceptedAsEmpty);
  const skillsResult = await runReview(context, { name: 'fixture', review: async () => empty() });
  witness('F13', { unobservedRulesReportedPassed: skillsResult.ruleCoverage.passed, total: skillsResult.ruleCoverage.total },
    skillsResult.ruleCoverage.passed === skillsResult.ruleCoverage.total && skillsResult.ruleCoverage.total > 0);
  let missingPullNumber = false; let createdReviews = 0;
  await publishSecurityReview({ rest: { pulls: {
    listReviews: async () => ({ data: [{ id: 1 }] }),
    listCommentsForReview: async (args) => {
      missingPullNumber = args.pull_number === undefined;
      if (missingPullNumber) throw new Error('Missing pull_number');
      return { data: [] };
    },
    createReview: async () => { createdReviews++; return { data: {} }; },
  }, issues: {} }}, { owner: 'o', repo: 'r', prNumber: 1, headSha: 'head', stickyComment: false,
    result: { summaryMarkdown: '', findings: [{ ...probe, startLine: 1, fingerprint: 'already-published' }] } });
  witness('F14', { missingPullNumber, createdReviews }, missingPullNumber && createdReviews === 1);
  let pages = 0;
  const bounded = await fetchPrContext({ rest: { pulls: {
    get: async () => ({ data: { number: 1, title: 'PR', head: { ref: 'feat', sha: 'h' }, base: { ref: 'main', sha: 'b' } } }),
    listFiles: async () => { pages++; return { data: Array.from({ length: 100 }, (_, i) => ({ filename: `file-${pages}-${i}.ts`, changes: 1, additions: 1, deletions: 0, status: 'modified' })) }; },
  }}}, { owner: 'o', repo: 'r' }, 1);
  witness('F15', { pages, returnedFiles: bounded.diff.files.length, truncationFlag: bounded.diff.filesTruncated },
    pages === 10 && bounded.diff.files.length === 1000 && !bounded.diff.filesTruncated);
  let fetchSignal;
  const transport = new OpenAiCompatibleProvider({ provider: 'openai', apiKey: 'synthetic', model: 'fixture', baseUrl: 'https://invalid.example/v1' }, undefined,
    async (_url, options) => { fetchSignal = options.signal; return { ok: true, json: async () => { await new Promise(r => setTimeout(r, 40)); return { choices: [{ message: { content: 'ok' } }] }; } }; }, 5);
  const completion = await transport.complete([{ role: 'user', content: 'fixture' }]);
  witness('F16', { requestTimeoutMs: 5, bodyDelayMs: 40, bodyReturned: completion.content, aborted: fetchSignal.aborted },
    completion.content === 'ok' && !fetchSignal.aborted);
  const lateFinding = await runReview(context, { name: 'fixture', review: async () => ({ ...empty(), findings: [
    ...Array.from({ length: 20 }, (_, i) => ({ ...finding, severity: 'low', title: `Low ${i}` })), finding,
  ] }) });
  witness('F17', { criticalAfterFirst20Retained: lateFinding.findings.some(f => f.severity === 'critical') },
    !lateFinding.findings.some(f => f.severity === 'critical'));
  const coerced = parseHarnessFindings(JSON.stringify({ findings: [{ ...finding, category: 'invented-category' }] }));
  witness('F18', { unknownCategoryMappedTo: coerced.findings[0].category, severity: coerced.findings[0].severity },
    coerced.findings[0].category === 'correctness' && coerced.findings[0].severity === 'critical');
  witness('F19-static', { allowlistedArgumentTokens: parsePiArgs('--max-duration 10 --model-override other') },
    parsePiArgs('--max-duration 10').includes('--max-duration'));
  // Do not write into the linked dependency directory; use an independent fixture.
  const fixtureRepo = join(scratch, 'fixture-repo');
  await mkdir(join(fixtureRepo, 'node_modules', '.bin'), { recursive: true });
  const untrustedBinary = join(fixtureRepo, 'node_modules', '.bin', 'biome');
  await writeFile(untrustedBinary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  witness('F02-static', { selectsWorkspaceBinary: findBinary(fixtureRepo, 'biome') === untrustedBinary },
    findBinary(fixtureRepo, 'biome') === untrustedBinary);
  globalThis.fetch = async () => { throw new Error('Synthetic provider outage'); };
  const securityOptions = { mode: 'security', profile: 'diff', minSeverity: 'medium', failOn: 'critical',
    confirmFindings: true, inlineComments: false, stickyComment: false, generateSarif: false,
    maxFindings: 20, riskThreshold: 'high', apiKey: 'synthetic', model: 'fixture', outputDir: scratch };
  const degraded = await runSecurityWorkflow({ repositoryPath: fixtureRepo, owner: 'o', repo: 'r',
    changedFiles: [], options: securityOptions }, securityOptions);
  witness('F08', { profile: 'diff', findings: degraded.findings.length, risk: degraded.conclusion.risk,
    reasoningFailureRecorded: 'engineStatus' in degraded.conclusion },
    degraded.findings.length === 0 && degraded.conclusion.risk === 'none' && !('engineStatus' in degraded.conclusion));
  const compiledSkills = Object.keys(BUILT_IN_SKILLS);
  const mismatches = [];
  for (const id of compiledSkills) {
    const file = await readFile(join(root, 'skills', id, 'SKILL.md'), 'utf8');
    if (file !== BUILT_IN_SKILLS[id]) mismatches.push(id);
  }
  console.log(JSON.stringify({ auditedCommit: 'f59cfc34f385d89754814f7b3649b7004fe7faa4', mode: assertBaseline ? 'assert-baseline' : 'observe-current',
    witnessCount: results.length, results, skillMirror: { profiles: compiledSkills.length, mismatches },
    limitations: 'Local deterministic witnesses; no live LLM/Copilot comparison; static witnesses do not execute malicious content.' }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalBuffer === undefined) delete process.env.AI_INLINE_BUFFER_PATH;
  else process.env.AI_INLINE_BUFFER_PATH = originalBuffer;
  if (originalConfig === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalConfig;
  await rm(scratch, { recursive: true, force: true });
}
