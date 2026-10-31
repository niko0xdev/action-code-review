# Improvement plan: audit and research synthesis

Date: 30/10/2026. Status updated 01/11/2026: all 23 tasks are merged (see Outcome). Inputs: a read-only source audit (19 findings, `AUD-xx`) and an external research pass (25 candidates, `R#`). Findings were not independently re-verified; confirm each against the code before fixing. At audit time `pnpm test` (616 tests), `pnpm lint`, and `pnpm typecheck` all passed.

## Overview

The foundation is sound and the main false-clean paths from `docs/research/improvement-roadmap.md` are fixed. Three themes remain:

1. **The bot can approve wrongly.** Auto-approve is on by default, and truncated diffs still count as reviewed.
2. **Hardening is uneven.** The main review path is locked down, but security mode, prelint, and semgrep inherit the full environment.
3. **There is no quality gate.** No CI runs lint, test, and build, and the committed `dist` bundles are not reproducible.

## Phase 1: Safety risks

- [x] **T1** Default `auto-approve-when-resolved` to false. When enabled, require a complete review, at least one prior AI thread, and no findings dropped by `min-severity`. (AUD-01, S) Done in #138.
- [x] **T2** Truncate diffs per file at hunk boundaries, record which files were included, mark the rest not-analysed, and close the code fence. (AUD-02, M) Done in #138.
- [x] **T3** Make the security engine reuse `buildPiArgs`, `buildPiEnv`, and `runPi`, including the timeout and process-group kill. (AUD-03, S–M) Done in #139.
- [x] **T4** Give prelint and semgrep an allowlisted environment, add `--` before file lists, drop file names starting with `-`, and cap stdout. (AUD-04, S–M) Done in #139.
- [x] **T5** Set `persist-credentials: false` in the workflow and add a canary test for credential reads. (AUD-05, S–M) Done in #137.

### Checkpoint: Safety

- [x] No default approval path can publish an approval over unpublished findings.
- [x] Every spawned analyser uses the minimal environment.

## Phase 2: Quick wins and CI gate

- [x] **T6** Add a CI workflow: lint, typecheck, test, `pnpm build`, then `git diff --exit-code pr-*/dist`. Pin ncc and make the build reproducible first. (AUD-06, M) Done in #137.
- [x] **T7** Add one shared validator for numeric env values (NaN, zero, negatives). A typo in `AI_REVIEW_MAX_FILES` currently exits green with no review. (AUD-07, S) Done in #141.
- [x] **T8** Remove the Pi install from `pr-content/action.yml`. Pin Pi with a shrinkwrap or an integrity check in `pr-review/action.yml`. (AUD-12, S) Done in #140.
- [x] **T9** Fix the self-review workflow: add `concurrency` and `timeout-minutes`, pin `checkout`, remove the broken `workflow_dispatch`. (AUD-18, S) Done in #137.
- [x] **T10** Fix the README `uses:` paths and the "Uses OpenAI" action descriptions. (AUD-18, S) Done in #140.
- [x] **T11** Use `StringDecoder` at `src/harness/pi.ts`. Report OSV network errors as `failed` and note truncation. (AUD-16, AUD-11, S) Done in #142.
- [x] **T12** Delete dead buffer code, normalise `include-dir` paths, and escape `?` in filters. (AUD-17, AUD-15, S) Done in #141.

## Phase 3: Review decision correctness

- [x] **T13** Compute `hasBlockingFinding` from all valid findings, and submit the review event separately from comments so `REQUEST_CHANGES` survives the fallback. (AUD-08, M) Done in #143.
- [x] **T14** Read `review-prompt-file` from the base ref and check `realpath` containment. (AUD-09, S–M) Done in #144.
- [x] **T15** Security mode: set `incomplete` when the confirm pass fails, clear `sarifPath` when the write fails, evaluate `fail-on` on all validated findings, and validate enum inputs. (AUD-10, S–M) Done in #144.
- [x] **T16** Retry only transient failures (429, 5xx) with backoff and `retry-after`; never retry 401. (AUD-13, S–M) Done in #143.
- [x] **T17** Split `main()` in `src/cli.ts` into review, content, and security runners, and add a coverage floor. (AUD-19, M–L) Done in #147.

## Phase 4: Review quality (research-driven)

Treat these as experiments; measure before committing.

- [x] **T18** Add Promptfoo as an eval harness for false-positive rate and prompt-injection regressions. Use Garak's probe taxonomy as reference. (R17, R16, M) Done in #149.
- [x] **T19** Add an LLM triage pass for false positives before findings are posted. Papers report large reductions but have no confirmed public repo, so measure locally. Depends on T18. (R2, R3, R19–21, M–L) Done in #154.
- [x] **T20** Trial `actions/dependency-review-action` (MIT) alongside the OSV scanner. (R10, S) Done in #146.
- [x] **T21** Trial `step-security/harden-runner` to limit egress during the review job. (R14, R22, S) Done in #146.
- [x] **T22** Select security skills by risk domain instead of appending all of them. Depends on T18. (AUD-14, M) Done in #155.
- [x] **T23** Feed OSSF Scorecard results into reviewer context. (R11, M) Done in #148.

## Licence notes

- AGPL-3.0 (trufflehog, `step-security/secure-repo`) and LGPL-2.1 (Opengrep): take ideas only, do not vendor code.
- `swe-prbench` (9 stars) is too immature; skip it.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Audit findings are unverified | Medium | Reproduce each with a failing test before fixing (TDD). |
| Changing the approval default breaks consumers | Medium | Note in `CHANGELOG.md` and the docs; keep the input available. |
| Reproducible build changes `dist` for unrelated reasons | Low | Land T6 first, then review the dist diff once. |
| Phase 4 adds cost or latency | Medium | Gate behind T18 measurements. |

## Delivery rules

One small PR per task or tightly related group. Each PR that touches `src/` follows `CLAUDE.md`: tests with the code, docs in the same PR, `pnpm build`, grep the dist for the change, and smoke-run `node pr-review/dist/index.js`.

## Outcome (01/11/2026)

All 23 tasks are merged to `main`, one reviewed pull request per task or small group, each independently reviewed before merging. The pull requests are #136 (this plan), #137 to #155 (the tasks), and #156 (a test fix, below).

### Where the work differs from the plan

- **T18:** no Promptfoo dependency. The repo rule is not to add a dependency for what a few lines can do, so `tests/eval` is a plain Vitest harness with a dependency-free scorer. Promptfoo appears only as a recipe in `docs/evaluation.md`.
- **T19:** no second triage stage. The existing verify pass already challenges high and critical findings, so #154 measures it, adds an opt-in `AI_REVIEW_VERIFY_MIN_SEVERITY`, and fixes a real defect (below).
- **T20:** the dependency review job is skipped until the owner enables the dependency graph and sets `DEPENDENCY_REVIEW_ENABLED=true`.
- **T21:** harden-runner runs in audit mode in CI only, and is deliberately absent from the review job that handles untrusted content with the model key.
- **T22 and T23:** opt-in and off by default (`security-skills: auto`, `scorecard-context: true`). Their effect on review quality is not measured.

### Defects found beyond the audit

- The offline harness (#149) found six real defects, fixed in #150, #151, and #152: a truncated file list still read as complete, the diff fence could be closed by backticks in a patch, newlines in file names escaped the fence, and the summary comment, JSON-escaped text, and zero-width splits defeated secret redaction.
- The redactor (#151) also had quadratic JWT and private-key patterns that a pull request author could use to stall the job.
- The verify pass (#154): the prompt told the model to omit rejected findings while the parser required a verdict for every candidate, so a compliant reply could never drop a finding and turned the step red. Verdicts are now matched by unique id.
- CI on `main` was red for several merges because two tests inherited the event from the runner and failed on `push` events (#156). Branch runs use `pull_request`, so they passed.

### Open items and decisions for the owner

- **Owner steps (not done, they are repository settings):** enable the dependency graph and set `DEPENDENCY_REVIEW_ENABLED=true` to activate dependency review; decide whether the harden-runner telemetry to its vendor is acceptable.
- **Quality is unmeasured.** The harness measures pipeline properties on canned data. A real baseline needs the live model run through `tests/eval/scoring.ts`, which also gates changing the `security-skills` default and judging the verify pass.
- **Verify strictness:** a missing, duplicate, or invalid verdict keeps every finding and marks the review incomplete, which fails the step by default. Applying the valid verdicts and keeping the rest is a considered option that changes the incomplete semantics.
- **Redaction gaps by design:** `ENCRYPTED PRIVATE KEY` and `PGP PRIVATE KEY BLOCK` headers, unsigned JWTs, signatures under 10 characters, and U+00A0, U+3000, U+2028, NUL, and C1 controls. The `security_findings` and `security_conclusion` outputs and some warning messages are not redacted.
- **Known limits of `security-skills: auto`:** a renamed path can hide a domain, a diff with no patch gets only the foundational skills, and no skill covers infrastructure as code.
- **Not added:** Dependabot and CODEOWNERS (new standing configuration). The Pi package is deprecated upstream in favour of a renamed package, worth a ticket. Semgrep with metrics off and no `--config` fails locally (pre-existing). OSV `next_page_token` pagination is not handled.
- **Behaviour changes to note in release notes:** auto-approve is off by default (#138), and a pull request with more than 1000 changed files now yields an incomplete review that fails the step by default (#150).
- **Flaky test to watch:** `tests/security/sandboxed-spawns.test.ts` timed out once at 30 s under heavy load and passed in isolation.
