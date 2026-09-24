# Product research: file-level review coverage — 2026-09-24

## Decision summary

**PROTOTYPE:** Extend the additive `review-report` output with a per-file
coverage ledger. Preserve the current aggregate fields and schema version.
This is a bounded transparency improvement; it does not establish a broader
roadmap commitment or claim that review accuracy improves.

## Decision and scope

The decision is whether a maintainer should be able to tell, for every file in
a pull request file list, whether it was reviewed, deliberately excluded, or
selected but not analyzed. The prototype records the file path, status, and a
closed reason enum in the existing machine-readable output. It does not publish
raw diffs or source content.

## Evidence

- **OBSERVED — local product gap:** `ReviewReportCoverage` reports aggregate
  reviewed/total/excluded counts. Its contract explicitly says `filesExcluded`
  combines configured filters, missing patches, and the `max-files` cap; a
  failed-group file is not distinguished by path. The implementation already
  has the original PR file list, configured filter result, selected list, and
  successfully reviewed paths at report time.
- **OBSERVED — integration surface:** the versioned `review-report` is an
  additive GitHub Action output. GitHub documents job summaries as a place to
  show useful run information, but this prototype uses the existing JSON
  output and does not add a summary table or a new output. GitHub also limits
  outputs to 1 MB per job, so the per-file ledger has a 128 Ki UTF-16 character
  ceiling and reports when any entries are omitted.
- **OBSERVED — external capability:** Alibaba Open Code Review's public
  delegate contract requires each `reviewable_files` entry to finish as
  reviewed or explicitly skipped, with a concrete reason. Its published
  `ocr review` documentation also describes JSON output. This shows a
  compatible transparency pattern in a neighboring product, not demand among
  this repository's users.
- **UNKNOWN — direct demand:** repository product state contains no interviews,
  support reports, or adoption data validating that users want file-level
  coverage. The competitor signal is not a prevalence estimate.

## Insight and hypothesis

When a review has a low or partial coverage count, a maintainer cannot tell
which files were omitted or whether the cause was policy, absent patch data,
the configured file cap, or a failed review group. If the report emits a
bounded ledger derived from the pipeline's existing deterministic lists,
workflow consumers can audit the scope without parsing logs or guessing from
aggregate counts.

## Why build / why not build

**Why build:** the missing distinction is documented in the local contract;
the pipeline already holds the required source lists; the report is explicitly
additive; no permission, dependency, provider call, or raw source disclosure is
needed. It also aligns with GitHub's native use of run summaries and with a
public competitor's per-file accounting contract.

**Why not build:** no local user has requested this, the feature is parity
rather than differentiation, and the ledger increases output size in very
large PRs. It does not improve detection or prove that a listed file was
reviewed well. A closed status vocabulary and one entry per file keep those
risks bounded.

**Lower-cost alternative:** add only aggregate exclusion counts by reason.
That would explain the totals but would not identify which files need workflow
or policy changes, so the prototype tests per-file entries while preserving
the existing aggregates.

## Opportunity score

| Dimension | Weight | Score |
|---|---:|---:|
| Strategic fit | 25% | 9/10 |
| User pain | 20% | 6/10 |
| Market evidence | 15% | 8/10 |
| Differentiation | 15% | 5/10 |
| Business value | 10% | 6/10 |
| Feasibility | 10% | 9/10 |
| Timing | 5% | 8/10 |

Raw score: **73/100**. Confidence: **0.78**. Confidence-adjusted score:
**56.94/100**. Effort: **S**. Recommendation: **PROTOTYPE**.

Confidence is limited because implementation feasibility and the local output
gap are directly observable, but user pain is inferred and there is no direct
repository demand evidence. Competitor capability alone is not treated as a
requirement.

## Acceptance for this prototype

- Each listed PR file is represented exactly once in `coverage.files`, unless
  the detail-size ceiling is hit; omissions are explicit and counted.
- Entries distinguish `reviewed`, `excluded`, and `not-analyzed`, with a
  concrete reason for every non-reviewed entry.
- Existing aggregate coverage fields and `schemaVersion: 1` remain stable.
- The report continues to omit source contents and apply existing string
  redaction when serialized.
- Documentation and tests cover configured filters, missing patches, default
  ignores, `max-files`, and failed review groups.

## Next validation

Ask maintainers who consume `review-report` whether the file list is useful or
whether aggregate reasons are sufficient. Measure serialized output size on a
large PR before considering any public contract beyond this additive field.

## Sources

- [GitHub Actions workflow commands: job summaries](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions)
- [GitHub Actions metadata syntax: output size limits](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax)
- [Alibaba Open Code Review delegate skill](https://github.com/alibaba/open-code-review/blob/main/skills/open-code-review-delegate/SKILL.md)
- [Alibaba Open Code Review project documentation](https://github.com/alibaba/open-code-review)
- Local primary sources: `src/review/report.ts`, `src/cli.ts`,
  `src/context/files.ts`, and `docs/v1-interface-contract.md`.
