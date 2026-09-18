# Competitor teardown: Alibaba `open-code-review` — 2026-09-18

Scope: competitive capability review of
[`alibaba/open-code-review`](https://github.com/alibaba/open-code-review)
("ocr"), used to decide one bounded, additive slice for this repository.
Baseline for this repository: `3a4862d` (2026-09-18). Competitor baseline:
`6ada4acf` (2026-09-18) on the competitor's `main`.

Evidence labels used throughout:

- **OBSERVED** — read directly in a primary source (repository file, commit,
  issue, or official documentation) at a dated revision.
- **SUPPORTED** — follows from observed facts plus a short, stated inference.
- **INFERRED** — a plausible reading that the available evidence does not
  settle.
- **UNKNOWN** — not established by any source consulted; recorded as a gap.

## Executive summary

Alibaba's `open-code-review` documents a deterministic engineering layer and
agent architecture, and its README documents a first-class machine-readable
review output (`ocr review --format json --output result.json`)
(**OBSERVED**). This makes it a direct public comparator for this action's
normal PR-review path.
It also has a public demand signal for a *stronger* machine-readable artifact:
issue #367 asks for an immutable review manifest with explicit partial-coverage
state, and it was closed by PR #520 (**OBSERVED**).

Two of the competitor's recent capabilities are explicitly **not** transferable
to this repository as-is:

- Opt-in automatic resolution of the action's own outdated review threads
  (`cb6ea262`, 2026-09-17) needs `contents: write` per the competitor's own
  documentation — above this repository's documented least-privilege contract
  (`contents: read`, `pull-requests: write`).
- Its broader agent/session architecture is a different product shape, not a
  bounded improvement to this action's normal review path.

The one slice selected for implementation here is the narrow, additive
machine-readable report: this repository's `ReviewResult` is already rich and
already carries completion status, but the normal action exposes only a prose
`review-summary` output. Adding a versioned `review-report` output is a small
diff, needs no new input or permission, preserves every frozen surface, and
closes a capability gap the competitor demonstrates is valuable.

**Recommendation: PROTOTYPE — `review-report` output only (implemented in this
change).** The raw score of 73/100 lands in the existing guide's 55–74
PROTOTYPE band, so this is a prototype slice rather than a BUILD commitment.
The user explicitly authorized this bounded implementation, which is why the
prototype ships now; that authorization covers only this local slice and is
not a broader roadmap commitment. All other competitor capabilities reviewed
here are recorded as WATCH or REJECTED WITH REASON, not as work items.

## Recent commit timeline (competitor `main`)

| Commit | Date | Change | Relevance to this repo |
|---|---|---|---|
| [`6ada4acf`](https://github.com/alibaba/open-code-review/commit/6ada4acf) | 2026-09-18 | Session-viewer header restyle | None — UI-only for the competitor's viewer |
| [`cb6ea262`](https://github.com/alibaba/open-code-review/commit/cb6ea262) | 2026-09-17 | Opt-in resolving of the action's own outdated review threads; default off; based on GitHub `isOutdated` plus vetoes | **Rejected here** — needs `contents: write` |
| [`ed274d58`](https://github.com/alibaba/open-code-review/commit/ed274d58) | 2026-09-17 | Prevent overlapping duplicate incremental-review comments | WATCH — adjacent to this repo's existing comment-identity dedupe |
| [`8d57bc9e`](https://github.com/alibaba/open-code-review/commit/8d57bc9e) | 2026-09-17 | Enforce token budget within a running group | WATCH — this repo has `max-context-chars` + verify budget but no per-group budget |
| [`f6f0f79`](https://github.com/alibaba/open-code-review/commit/f6f0f79) | 2026-09-17 | Enforce global code-search result limit | WATCH — bounded tool output; this repo bounds prompt context instead |

The four functional commits land in a single week (**OBSERVED**): the
competitor ships review-integrity and cost-control work at a high cadence.
Cadence alone is not a quality claim — the underlying defects those commits fix
were not independently reproduced here (**UNKNOWN**).

## Verified capability comparison

| Capability | This repo (at `3a4862d`) | Competitor (at `6ada4acf`) | Evidence |
|---|---|---|---|
| Machine-readable review output | Only prose `review-summary` output; `ReviewResult` internally rich | `ocr review --format json --output result.json` documented in README | OBSERVED |
| Explicit partial-coverage state | `reviewStatus` (`complete`/`incomplete`/`failed`/`stale`) + `failedGroups` diagnostics | Issue #367 requests it; closed via #520 | OBSERVED |
| Deterministic pre-analysis layer | Opt-in prelint (biome/ruff/swiftlint/ktlint/sqlfluff) feeding the prompt | Documented "deterministic engineering" layer | OBSERVED (both) |
| Agent architecture | Pi harness with repository tools, profile rules, verify pass | Documented agent architecture, session viewer | OBSERVED (both) |
| Auto-resolve own outdated threads | Not implemented; would need `contents: write` | Opt-in, default off, `cb6ea262` | OBSERVED |
| Per-group token budget | Not enforced per group | Enforced, `8d57bc9e` | OBSERVED |
| Global tool/search result cap | Prompt context cap (`max-context-chars`) | Search result cap, `f6f0f79` | OBSERVED |
| Least-privilege permissions | `contents: read`, `pull-requests: write` documented and frozen | Not verified for the competitor | UNKNOWN |

Direct quality comparison (finding precision, recall, false-positive rate) is
**UNKNOWN**: no head-to-head benchmark on the same PR corpus was run, and the
competitor's README is a marketing surface. Nothing here should be read as a
claim that either engine reviews better.

## Feature opportunities

Ranked by boundedness and fit with this repository's documented priorities
(correctness, honest incomplete results, secret protection, frozen consumer
interfaces).

1. **Versioned machine-readable review report — PROTOTYPE (implemented here).**
   Additive output, no new input, no new dependency, no permission change.
   Closes the clearest capability gap. See the decision record at
   `.product-intelligence/opportunities/2026-09-18-review-report-output.json`.
2. **Per-group execution budget — WATCH.** The competitor enforces a token
   budget within a running group
   ([`8d57bc9e`](https://github.com/alibaba/open-code-review/commit/8d57bc9e)).
   This repository bounds total
   prompt context and the optional verify pass, but a single long-running
   review group can still consume an unbounded amount of harness time. Bounded
   in principle, but it changes runtime cost behavior and needs its own
   acceptance criteria and measurements. Not in this slice.
3. **Incremental-run comment de-duplication hardening — WATCH.** The
   competitor fixed overlapping duplicate incremental-review comments
   ([`ed274d58`](https://github.com/alibaba/open-code-review/commit/ed274d58)).
   This repository already de-duplicates by a SHA-256 comment
   identity and buffers inline comments, so the marginal value is unclear
   without a reproduced failure. Not in this slice.

## Why automatic thread resolution was rejected for this repository

The competitor's
[`cb6ea262`](https://github.com/alibaba/open-code-review/commit/cb6ea262)
resolves the action's own outdated review threads
when opted in. It is a real capability, but it is out of bounds here:

- The competitor's own action documentation states the mutation requires
  `contents: write` (**OBSERVED**).
- This repository's frozen contract documents the expected caller permissions
  as exactly `contents: read` and `pull-requests: write`, and states the
  actions must not require more (`docs/v1-interface-contract.md`).
- Raising the required permission set is a consumer-visible security change:
  it widens what a compromised or misconfigured workflow can do to repository
  contents, and it would invalidate the documented permission contract.

**Decision: REJECTED for this repository** — not because the feature is
worthless, but because it cannot be delivered inside the documented
least-privilege contract. Any future attempt would need an explicit human
security decision and a contract revision, not an additive change.

## Score for the JSON output slice

Scored on the same weighted dimensions this repository uses for opportunity
records. Weights sum to 1.00; the raw score is `Σ(score × weight) × 10`.

| Dimension | Weight | Score (0–10) | Weighted |
|---|---:|---:|---:|
| Strategic fit | 0.25 | 10 | 2.50 |
| User pain | 0.20 | 7 | 1.40 |
| Market evidence | 0.15 | 6 | 0.90 |
| Differentiation | 0.15 | 3 | 0.45 |
| Business value | 0.10 | 6 | 0.60 |
| Feasibility | 0.10 | 10 | 1.00 |
| Timing | 0.05 | 9 | 0.45 |
| **Raw** | **1.00** | | **7.30 / 10 = 73 / 100** |

**Adjusted score formula:**

```text
adjusted = raw × confidence = 73 × 0.85 = 62.05 / 100
```

Chosen confidence: **0.85**. The implementation slice itself is strongly
evidenced (the review result model already carries every field, and the frozen
contract explicitly permits additive outputs), which supports high confidence.
It is held below 1.0 because the demand side rests on one public issue plus a
competitor's shipped feature, and this repository has no direct user reports.

**Recommendation: PROTOTYPE**, scoped to the additive `review-report` output.
The raw score of 73/100 falls in the existing scoring guide's 55–74 PROTOTYPE
band, so this is a prototype slice, not a BUILD commitment and not a broader
roadmap entry. The user explicitly authorized this bounded implementation for
both the ideation and the implementation, which is why it proceeds now; that
authorization covers this repository's local implementation, tests, docs, and
research artifacts only — it does not authorize push, release, or any
permission change. Low differentiation is the main weakness and is why this is
scoped as parity, not as a differentiating bet.

## Counter-evidence and limitations

- **One demand signal is not market demand.** Issue #367 is a single public
  request from one project's community. It is treated here as one signal, not
  as proof of broad demand, and the opportunity record's user-pain score
  reflects that.
- **A closed issue does not prove a shipped, complete fix.** #367 was closed
  via #520; the closure was not verified against the resulting code in this
  pass. Treat "the competitor solved this" as **INFERRED**.
- **No quality comparison exists.** Nothing here measures review precision,
  recall, cost per PR, or latency against the competitor. The comparison is
  capability-shaped, not outcome-shaped.
- **Competitor README claims are marketing, not evidence.** Architecture and
  format claims were read as claims; only file/commit/issue contents were
  treated as observed facts.
- **Adoption, pricing, and UX of the competitor are UNKNOWN.** No pricing page,
  adoption metric, or hands-on UX session was consulted; the corresponding
  product-intelligence files explicitly record those gaps rather than
  inventing values.
- **This slice does not improve review quality.** It improves the
  *machine-readability and honesty* of what the review already produces.

## Primary sources

- Competitor repository: <https://github.com/alibaba/open-code-review>
- Competitor `main` at review time (2026-09-18), commit `6ada4acf`:
  <https://github.com/alibaba/open-code-review/commit/6ada4acf>
- Thread-resolution commit (2026-09-17), `cb6ea262`:
  <https://github.com/alibaba/open-code-review/commit/cb6ea262>
- Duplicate-comment commit (2026-09-17), `ed274d58`:
  <https://github.com/alibaba/open-code-review/commit/ed274d58>
- Group token-budget commit (2026-09-17), `8d57bc9e`:
  <https://github.com/alibaba/open-code-review/commit/8d57bc9e>
- Search-result-limit commit (2026-09-17), `f6f0f79`:
  <https://github.com/alibaba/open-code-review/commit/f6f0f79>
- Machine-readable manifest request, issue #367 (opened 2026-07-14, closed via
  [#520](https://github.com/alibaba/open-code-review/pull/520)):
  <https://github.com/alibaba/open-code-review/issues/367>
- Competitor license (Apache-2.0, observed 2026-09-18):
  <https://github.com/alibaba/open-code-review/blob/main/LICENSE>
- This repository's frozen contract: `docs/v1-interface-contract.md`
- This repository's review result model: `src/types/finding.ts`
