# Audit remediation and canary verification

Authorised on 17/11/2026. Audit baseline: ee03388. Implementation base: edbc187, the current main branch. Existing plans and research are preserved.

## Ordered work and acceptance criteria

1. Runtime boundaries and telemetry (F07, F08, F13): repository content cannot replace system instructions or read outside the analysed snapshot; configured limits use actual events; fallback uses the same isolated runtime. Verify with real pinned Pi and a loopback provider, synthetic outside-path and symlink canaries, and bounded tool calls.
2. Completion and security policy (F02, F03, F14, F15, F16, F17): malformed or partial work cannot be complete/clean; confirmation errors retain candidates; independent occurrences survive scope checks; failure policy uses the complete validated set. Verify red/green regression tests and fault fixtures.
3. Publication and content (F09, F10, F11, F12, F19): current blockers survive deduplication; markers require publisher identity; escalation honours permissions; concurrent content edits survive; template text remains literal. Verify fake GitHub state transitions.
4. Evidence, redaction, and deterministic tests (F04, F05, F06, F18, F20): verifier decisions cite supplied source evidence; truncation is reported honestly; integration tests use controlled transports; all SARIF fields are redacted; analyser locations match real output. Verify focused fixtures and the full suite.
5. Distribution and delivery (F01): rebuild both bundles, enforce parity, smoke-run, self-review, commit, push, and merge only after checks pass. Verify a real canary PR using the merged revision, with published results and workflow logs. Do not merge deliberate canary defects.

## Progress

- [x] Preserve the original workspace and create a branch/worktree from current main.
- [x] Record each finding as already fixed or corrected here with regression evidence.
- [x] Complete all focused tests and the full quality gates.
- [x] Rebuild both bundles and verify parity and startup behaviour.
- [ ] Review and merge the verified changes.
- [ ] Run and inspect an actual GitHub PR canary after merge.

## Verification rules

Keep tests deterministic by default. Real-model quality and deterministic live GitHub publication are distinct checks. Use repository secrets only inside Actions. Never expose secret values. No production tag or unrelated release is authorised. Any unavailable live-model credentials or repository policy must be reported precisely.

## Local verification on 18/11/2026

- Typecheck and Biome passed.
- Coverage suite: 1,864 passed, five existing live-evaluation cases skipped, and seven existing measurement placeholders. No new skipped cases.
- Coverage: lines/statements 90.13%, branches 87.36%, and functions 91.03%. Existing thresholds are unchanged.
- Actual pinned-runtime suite: five passed against loopback, including Unicode path-normalisation bypass regression, traversal/symlink isolation, usage, and independent limits.
- Both bundles rebuilt and both unsupported-event startup guards smoke-ran successfully.
- Confirmation partition regressions failed before correction, then all 165 focused security tests passed.

- Each subprocess receives its own complete guard file; a concurrency regression prevents shared-file truncation during parallel startup.

- Linux workflows install the offline search prerequisites; the review workflow uses an explicit 120-call maximum after repeated exhaustion of the default 60 on this large remediation. Actual offline grep is covered by the runtime suite.

- The measured selected patch set exceeds 86,000 characters. The repository workflow supplies 150,000 characters so the complete selected input fits; omitted input remains incomplete.

- Live self-review follow-up: four new regression cases proved the owned runtime configuration gap and cleanup result loss before correction. A fifth real-runtime case verifies the gateway with an initially empty owned directory. Public security engine types now describe the complete confirmation partition.

- Six alternative-provider default-model assertions failed before correction, then passed. Native model and gateway overrides remain explicit. The real-runtime fixture covers denied find/list calls and an allowed repository listing.

- Non-object stream events and malformed message content no longer crash event consumption. Confirmation retains existing remediation unless a non-empty replacement is supplied; malformed remediation makes the batch incomplete. Failing regression evidence is retained in the delivery log.

- Custom gateways cannot borrow ambient native credentials. A gateway rejection regression and a confirmation diagnostic assertion failed before correction, then passed. Reasoning and confirmation failures are now diagnosable without exposing raw responses.

- Three synthetic-credential regressions failed before correction. Provider errors, stderr, and malformed-output diagnostics now redact complete strings before clipping, preventing long credential tails from leaking into errors.
