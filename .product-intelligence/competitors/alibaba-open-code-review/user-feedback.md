# User feedback: Alibaba `open-code-review`

## Issue #367 — machine-readable immutable review manifest (OBSERVED)

- Opened: 2026-07-14
- Closed via: PR #520
- Ask: a machine-readable, immutable review manifest plus explicit
  partial-coverage state.
- Confidence that the request was made publicly: **OBSERVED** (issue).
- Confidence that the closure fully satisfies it in shipped code: **INFERRED**
  — PR #520 was not read line-by-line in this pass.

This is treated as **one demand signal**, not as proof of broad market demand.
A single issue from one project's community does not establish that a general
audience wants the same artifact, and it says nothing about willingness to pay
or about how many users hit the underlying limitation silently.

## Other feedback — UNKNOWN

No issue triage, discussion sampling, review mining, or user survey was
performed for this competitor. Complaint themes, feature-request frequency,
satisfaction, and churn signals are UNKNOWN and must not be invented.

## Interpretation guidance

Do not restate #367 as "the market demands immutable review manifests". The
defensible statement is: a machine-readable review manifest with explicit
coverage state was requested publicly by at least one consumer of a comparable
tool, and the maintainers acted on it.
## 2026-09-18 — Large-review budgets and failed-run visibility

- **OBSERVED, issue #409 (2026-07-20):** one user reported high token use during
  a large private MR before timeout and fallback. The sanitized logs are
  user-provided and not independently verified.
- **OBSERVED, PR #508 (merged 2026-07-30):** the project added aggregate review
  token/tool-call budgets, partial-result status, and structured usage
  reporting on failure. The PR explicitly deferred an elapsed-time budget.
- **OBSERVED, issue #707 (2026-08-03):** one user asked to configure the
  per-file prompt ceiling for large-context models. PR #716 merged a
  per-file override on 2026-08-07.
- **OBSERVED, issue #771 (2026-08-07):** one user asked for JSON to expose an
  existing aggregate token-budget stop. PR #791 merged the reporting change
  on 2026-08-16.

These reports come from one project's community and concern different kinds of
budgets. They do not establish broad demand or prove that this repository's
users need the same controls.
