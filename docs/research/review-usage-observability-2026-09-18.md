# Product research: machine-readable review usage — 2026-09-18

## Decision summary

**PROTOTYPE:** Add provider-reported Pi token counters, tool-call attempts,
elapsed time, and process counts to the existing `review-report`, including
when some review groups fail. Keep the report numeric and structured; do not
include raw logs or estimate dollars.

The user explicitly asked for research followed by implementation using Claude
Code. That authorizes this bounded local prototype, not a broader roadmap
commitment or remote action.

## Evidence and what changed

### OBSERVED — an external cost incident led to usage and budget changes

Alibaba `open-code-review` issue [#409](https://github.com/alibaba/open-code-review/issues/409)
reported one large private merge request that made many model/tool calls before
timing out. The author reported sanitized logs of about 90.4 million tokens
over 72 minutes; the private workload and numbers were not independently
verified.

The issue was addressed by merged PR
[#508](https://github.com/alibaba/open-code-review/pull/508) on 2026-07-30.
Its implementation added aggregate token and tool-call budgets, partial-result
status, and structured usage on failure. The PR explicitly deferred a maximum
elapsed-time control. This weakens the case for copying the incident as a
request for a time limit; this research instead selects the narrower
machine-readable usage surface.

Two other public requests in the same project show related but distinct jobs:

- Issue [#707](https://github.com/alibaba/open-code-review/issues/707) asked
  for a configurable per-file prompt ceiling; PR
  [#716](https://github.com/alibaba/open-code-review/pull/716) merged the
  override on 2026-08-07.
- Issue [#771](https://github.com/alibaba/open-code-review/issues/771) asked
  JSON output to expose an already-detected token-budget stop; PR
  [#791](https://github.com/alibaba/open-code-review/pull/791) merged that
  reporting change on 2026-08-16.

These are multiple individual user signals within one project's community,
not evidence of prevalence in the overall market or in this repository.

### OBSERVED — this repo has a practical reporting path

The action already consumes Pi's JSONL event stream and saves each run's
stdout/stderr for debug reporting. Its `review-report` is a stable additive
JSON output that already describes status, coverage, findings, and diagnostics.
It does not currently contain token usage, tool-call counts, or elapsed review
time.

The installed runtime is Pi `0.73.1`, the version pinned by
[`pr-review/action.yml`](../../pr-review/action.yml). Pi's JSON mode documents
`message_end` as the final authoritative message event and includes
`tool_execution_start` events in its JSONL stream
([Pi JSON mode docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/json.md)).
The pinned local runtime types define provider-reported `input`, `output`,
`cacheRead`, `cacheWrite`, and `totalTokens` counters. This makes a numeric
summary feasible without exposing event logs.

## Insight and hypothesis

When a maintainer sees an incomplete or failed PR review, they need to know
what work the action completed so they can audit usage and diagnose the run.
If `review-report` aggregates Pi's numeric usage and tool-start events across
all groups, including failed processes, CI consumers can read this evidence
without scraping debug text.

## Why build / why not build

**Why build:** Usage is already present in the event stream, and this repo now
has a structured output consumers can use. The implementation is additive and
needs no new input, permission, or dependency.

**Why not build:** There is no direct demand report in this repository. The
feature is parity rather than differentiation. Pi cannot report usage for an
in-flight request that is killed before its final usage event, and token counts
are not exact dollar costs.

The cheaper alternative is debug-only raw logs, which are difficult for CI
consumers to parse and may contain much more detail than they need. The
separate alternative of a review-wide timeout is not selected: it is a weaker
proxy for cost, and the comparator's PR #508 deferred that control.

## Score and recommendation

| Dimension | Weight | Score |
|---|---:|---:|
| Strategic fit | 25% | 9/10 |
| User pain | 20% | 7/10 |
| Market evidence | 15% | 7/10 |
| Differentiation | 15% | 2/10 |
| Business value | 10% | 6/10 |
| Feasibility | 10% | 9/10 |
| Timing | 5% | 8/10 |

Raw score: **67.5/100**. Confidence: **0.82**. Confidence-adjusted score:
**55.35/100**.

**Recommendation: PROTOTYPE.** Limit the output to numeric usage and bounded
run status. Mark counters as provider-reported, keep `schemaVersion: 1` because
the fields are additive, and do not publish raw logs or estimated USD.

## Next validation

After implementation, test the pinned Pi 0.73.1 event format against successful
and interrupted fixture runs, and ask maintainers who consume `review-report`
whether these fields are useful. Revisit a hard usage budget only if reliable
accounting across supported providers is established.

## Research artifacts

- Opportunity: [`.product-intelligence/opportunities/2026-09-18-review-usage-output.json`](../../.product-intelligence/opportunities/2026-09-18-review-usage-output.json)
- Insight: [`.product-intelligence/insights/2026-09-18-review-usage-observability.md`](../../.product-intelligence/insights/2026-09-18-review-usage-observability.md)
- Signals: [`.product-intelligence/signals/2026-09.jsonl`](../../.product-intelligence/signals/2026-09.jsonl)
