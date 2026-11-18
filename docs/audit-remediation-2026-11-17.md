# Audit remediation: 17 November 2026

The audit examined `ee03388`. Remediation starts from `edbc187`, preserving the intervening main-branch fixes. A finding is closed by its current behaviour and regression evidence, rather than by changing its historical classification.

## Finding coverage

| Finding | Outcome and regression evidence |
|---|---|
| F01: stale distribution bundles | Both bundles are rebuilt; the existing CI parity check remains mandatory. CI additionally executes the real pinned runtime boundary suite. |
| F02: malformed regular review reads as clean | The parser preserves useful candidates but marks invalid envelopes/candidates incomplete. Missing findings arrays are rejected. Completion tests cover the combined result state. |
| F03: truncated PR discovery permits approval | Existing main-branch truncation handling is retained and extended across harness/report/publisher boundaries. No incomplete assessment can approve. |
| F04: verifier drops findings without source | Candidate verdicts reference complete supplied patches from the same base/head revision. Only an explicit source-backed refutation removes a candidate; uncertain/error/partial verdicts retain findings and mark the assessment incomplete. |
| F05: prompt assignment overstates coverage | Complete supplied patches and omitted/partial patches have separate path lists. Missing marker space does not erase omissions. Coverage states do not claim observed tool inspection. |
| F06: tests invoke the user's runtime | Default security workflow tests inject controlled engines/scanners. Actual runtime tests use a separately installed, locked Pi executable and a loopback provider. |
| F07: runtime discovery and filesystem boundary | Startup uses an isolated working directory/home, explicit system instructions, and one action-owned boundary extension. Canonical tool paths must remain in the source root, except exact trusted skill files. Outside paths, symlinks escaping the root, and Git metadata are blocked. |
| F08: text protocol disables budgets/usage | JSON events are decoded incrementally across chunk boundaries. Deltas are counted and discarded to avoid accumulated-message amplification. Completed events retain usage and answers. Tool and assistant limits operate independently. |
| F09: deduplication can approve a blocker | Existing full-assessment blocking is retained. Comment markers now require the authenticated publisher or the standard Actions bot fallback. |
| F10: permission check misses change requests | REQUEST_CHANGES uses the same write-permission decision as approval; read-only actors receive COMMENT. |
| F11: generated content overwrites newer edits | Publication compares the original head, title, and body with the latest snapshot. A conflict skips the write and does not trigger another generation retry. |
| F12: dollar sequences corrupt templates | Replacement callbacks preserve literal generated descriptions and testing information. |
| F13: security CLI fallback lacks boundaries | The fallback uses the same isolated transport, structured output, execution limits, and canonical tool guard as regular review. Existing alternative provider support is retained. |
| F14: malformed security reasoning reads as clean | Invalid envelopes/candidates and unsuccessful exits fail reasoning while preserving static evidence; the conclusion is incomplete. |
| F15: malformed confirmation deletes candidates | Confirmation requires explicit valid verdicts; invalid/partial results preserve the original assessment and make it incomplete. Refutations remain inspectable. |
| F16: separate occurrences collapse before scope | Occurrence identity includes location; scope validation precedes presentation deduplication. Repeated rules at different source locations remain independent. |
| F17: publication filters bypass failure policy | Risk and failure thresholds use the complete validated pool before severity display filters and presentation caps. |
| F18: structured fields and long-key tails leak | Final SARIF serialization redacts every string value. Long provider-key payloads are redacted in full. Existing linear-time redaction tests remain required. |
| F19: contributor markers suppress security output | Inline deduplication and sticky selection verify publisher authorship and paginate existing comments. |
| F20: analyser evidence has invalid locations | Biome object paths are normalised and UTF-8 byte spans map to source lines within the canonical root. SQLFluff array reports and current line fields are accepted. |

## Verification

Run the default gates:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm build
git diff --exit-code -- pr-review/dist pr-content/dist
```

The parity check is run after the rebuilt bundles have been committed. Before committing, inspect their diff and smoke-run both entrypoints with an explicitly unsupported event.

Run actual-runtime boundary tests without external model traffic. Install `ripgrep` on the host first; offline Pi search requires the host binary:

```sh
npm ci --prefix pr-review/pi-runtime --ignore-scripts --no-audit --no-fund
pnpm test:runtime
```

The loopback tests prescribe tool calls and synthetic credentials. They establish enforcement and accounting behaviour, not a prompt-injection success rate or measured model quality.

## Runtime trust and remaining limits

The boundary extension is generated by the Action in its trusted configuration directory; target extensions remain disabled. It canonicalises tool input before invoking the read-only built-in tools. The subprocess runs outside the target checkout so target system/append prompts and package configuration are not startup authority. The model may still read repository text as untrusted task data.

This is an application-enforced tool boundary, not a claim of an OS sandbox. The runner, installed pinned runtime, and any explicitly configured custom executable remain trusted. No target build, test, shell, or write tool is enabled. Runtime telemetry reports observed completed events; a killed in-flight provider request can still lack final billing data.

## Delivery and live verification

The implementation PR must pass the full quality and runtime gates before merge. After merge, use an isolated canary PR based on that exact main revision, inspect actual workflow execution and published review state, then push a safe correction and inspect the rerun. Close the canary without merging deliberate defects. Record the merge SHA, workflow/run identifiers, review outcomes, and any genuine limitations in the delivery report.

## Repository review workflow allowance

The repository's own Linux review workflow explicitly installs `ripgrep` and `fd-find` before starting offline inspection. Repeated large-remediation reviews exhausted the default 60-call ceiling without producing a complete assessment. The workflow therefore allows at most 120 calls and asks the reviewer to plan within 100, while retaining timeout/output limits and incomplete-result handling. The selected patches in this audit PR total approximately 86,000 characters, above the default 30,000-character context cap. The repository workflow therefore supplies a finite 150,000-character context budget so selected patches fit without silently claiming clipped source as reviewed. The distributed Action's defaults remain unchanged. The runtime suite additionally exercises actual offline grep with repository-relative and blocked outside paths.

## Fallback configuration and contracts

Live self-review identified a genuine owned-runtime configuration gap: fallback runs created an isolated directory but did not write gateway models or disable compaction there. The shared configuration writer now installs those files atomically while retaining built-in alternative-provider models when no gateway override is supplied, for both caller-owned and newly allocated directories. Regression tests cover both cases.

The exported security engine contract now documents the complete confirmation partition and its explicit refutation ledger, and the secondary module re-exports that canonical type. Cleanup failures produce a redacted warning while preserving a completed assessment or the original error.

The independent verifier deliberately has a separate 24,000-character evidence budget. Raising the main review context does not raise this second-pass allowance. A candidate whose complete source patch cannot fit is retained with incomplete verification, preventing approval. This is a documented bounded-verification limit, rather than permission to silently discard an unverified candidate.

## Provider and runtime limits

The native fallback does not forward the Action's default `gpt-4` model to a different provider without an explicit gateway. Explicit native model choices and gateway model overrides remain honoured. Regressions cover all six alternative-provider keys. The actual-runtime boundary fixture also exercises denied `find`/`ls` inputs and an allowed repository listing.

Strict security envelope validation is intentional: a malformed candidate makes reasoning incomplete while static findings remain available. The output-byte guard bounds retained structured stdout, an individual pending line, and stderr independently. Accumulated update snapshots are discarded; their total wire volume is not capped. Tool calls, assistant text, and process time have separate limits, so a stream consisting solely of discarded non-text updates can run until the timeout. These remaining limits are explicit and do not constitute clean completion or approval.

The consumer treats non-object JSON event lines and malformed message content as inert diagnostics while retaining valid terminal events. Confirmation preserves existing remediation when no non-empty replacement is returned, and a malformed remediation field makes the batch incomplete. The native fallback references the canonical frozen Action model default.

A custom gateway must have its own explicit API key. The security fallback rejects the combination of a gateway URL and an ambient native-provider key before spawning, preventing automatic routing of unrelated credentials. Native providers retain their native endpoints. Reasoning, confirmation, and cleanup failures emit bounded, pattern-redacted diagnostics while preserving the existing incomplete-result and retention policies.
