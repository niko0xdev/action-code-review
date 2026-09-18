# Insight: failed reviews need machine-readable usage evidence

## Pattern

Signals `sig-20260918-alibaba-review-cost-runaway`,
`sig-20260918-alibaba-cost-guardrails-shipped`, and
`sig-20260918-alibaba-budget-status-json` show users of one public code-review
project asking to control spend and understand partial or failed runs. The
merged PR that addressed the reported cost incident added token/tool-call
budgets and a structured usage record on failure. This is direct evidence of
a user job in that project's community, not a market-wide trend.

Signals `sig-20260918-pi-json-usage-events` and
`sig-20260918-local-review-deadline-gap` show this repository already consumes
Pi's JSON event stream and retains per-process logs, while its `review-report`
does not include usage. The pinned Pi runtime reports token counters on
completed assistant messages and emits tool-call-start events. These counters
can be aggregated without forwarding source text or raw logs.

## User job and opportunity

When a maintainer reviews an incomplete or failed PR analysis, they need to
see how much provider-reported work completed and how many tool calls were
started. Add an additive, numeric usage summary to the existing machine-readable
`review-report`, including for runs where some Pi groups fail.

## Counter-evidence and alternate explanation

- The requests and merged implementation all come from one competitor's
  community. This repository has no direct user request for usage reporting.
- The comparator already shipped token/tool-call budgets and usage on failure;
  this is parity and integration value, not a differentiator.
- Pi's usage is provider-reported. An interrupted in-flight call may not emit a
  final usage event, and custom OpenAI-compatible endpoints may report zero or
  incomplete counts.
- A token count is not an exact dollar amount. Provider pricing and billing
  behavior are not standardized by this action, so this slice should not emit
  estimated USD cost.
- A review-wide time limit could be useful, but it is a weaker proxy than
  reported usage and the same competitor explicitly deferred an elapsed-time
  guard. Do not implement it in this slice.

## Confidence

**SUPPORTED, 0.82.** The user request and merged response are directly
observed; the local output gap and Pi event capability are verified in source.
Applicability to this product's users and the completeness of usage on failed
calls remain unknown.

## What would change the conclusion

Direct maintainer feedback, or a replay showing the pinned Pi runtime does not
emit usable usage counters for supported providers, would change the value or
scope of this prototype.
