# Improvement plan: audit and research synthesis

Date: 30/10/2026. Inputs: a read-only source audit (19 findings, `AUD-xx`) and an external research pass (25 candidates, `R#`). Findings were not independently re-verified; confirm each against the code before fixing. At audit time `pnpm test` (616 tests), `pnpm lint`, and `pnpm typecheck` all passed.

## Overview

The foundation is sound and the main false-clean paths from `docs/research/improvement-roadmap.md` are fixed. Three themes remain:

1. **The bot can approve wrongly.** Auto-approve is on by default, and truncated diffs still count as reviewed.
2. **Hardening is uneven.** The main review path is locked down, but security mode, prelint, and semgrep inherit the full environment.
3. **There is no quality gate.** No CI runs lint, test, and build, and the committed `dist` bundles are not reproducible.

## Phase 1: Safety risks

- [ ] **T1** Default `auto-approve-when-resolved` to false. When enabled, require a complete review, at least one prior AI thread, and no findings dropped by `min-severity`. (AUD-01, S)
- [ ] **T2** Truncate diffs per file at hunk boundaries, record which files were included, mark the rest not-analysed, and close the code fence. (AUD-02, M)
- [ ] **T3** Make the security engine reuse `buildPiArgs`, `buildPiEnv`, and `runPi`, including the timeout and process-group kill. (AUD-03, S–M)
- [ ] **T4** Give prelint and semgrep an allowlisted environment, add `--` before file lists, drop file names starting with `-`, and cap stdout. (AUD-04, S–M)
- [ ] **T5** Set `persist-credentials: false` in the workflow and add a canary test for credential reads. (AUD-05, S–M)

### Checkpoint: Safety

- [ ] No default approval path can publish an approval over unpublished findings.
- [ ] Every spawned analyser uses the minimal environment.

## Phase 2: Quick wins and CI gate

- [ ] **T6** Add a CI workflow: lint, typecheck, test, `pnpm build`, then `git diff --exit-code pr-*/dist`. Pin ncc and make the build reproducible first. (AUD-06, M)
- [ ] **T7** Add one shared validator for numeric env values (NaN, zero, negatives). A typo in `AI_REVIEW_MAX_FILES` currently exits green with no review. (AUD-07, S)
- [ ] **T8** Remove the Pi install from `pr-content/action.yml`. Pin Pi with a shrinkwrap or an integrity check in `pr-review/action.yml`. (AUD-12, S)
- [ ] **T9** Fix the self-review workflow: add `concurrency` and `timeout-minutes`, pin `checkout`, remove the broken `workflow_dispatch`. (AUD-18, S)
- [ ] **T10** Fix the README `uses:` paths and the "Uses OpenAI" action descriptions. (AUD-18, S)
- [ ] **T11** Use `StringDecoder` at `src/harness/pi.ts`. Report OSV network errors as `failed` and note truncation. (AUD-16, AUD-11, S)
- [ ] **T12** Delete dead buffer code, normalise `include-dir` paths, and escape `?` in filters. (AUD-17, AUD-15, S)

## Phase 3: Review decision correctness

- [ ] **T13** Compute `hasBlockingFinding` from all valid findings, and submit the review event separately from comments so `REQUEST_CHANGES` survives the fallback. (AUD-08, M)
- [ ] **T14** Read `review-prompt-file` from the base ref and check `realpath` containment. (AUD-09, S–M)
- [ ] **T15** Security mode: set `incomplete` when the confirm pass fails, clear `sarifPath` when the write fails, evaluate `fail-on` on all validated findings, and validate enum inputs. (AUD-10, S–M)
- [ ] **T16** Retry only transient failures (429, 5xx) with backoff and `retry-after`; never retry 401. (AUD-13, S–M)
- [ ] **T17** Split `main()` in `src/cli.ts` into review, content, and security runners, and add a coverage floor. (AUD-19, M–L)

## Phase 4: Review quality (research-driven)

Treat these as experiments; measure before committing.

- [ ] **T18** Add Promptfoo as an eval harness for false-positive rate and prompt-injection regressions. Use Garak's probe taxonomy as reference. (R17, R16, M)
- [ ] **T19** Add an LLM triage pass for false positives before findings are posted. Papers report large reductions but have no confirmed public repo, so measure locally. Depends on T18. (R2, R3, R19–21, M–L)
- [ ] **T20** Trial `actions/dependency-review-action` (MIT) alongside the OSV scanner. (R10, S)
- [ ] **T21** Trial `step-security/harden-runner` to limit egress during the review job. (R14, R22, S)
- [ ] **T22** Select security skills by risk domain instead of appending all of them. Depends on T18. (AUD-14, M)
- [ ] **T23** Feed OSSF Scorecard results into reviewer context. (R11, M)

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
