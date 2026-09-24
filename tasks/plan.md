# Implementation Plan: File-level review coverage

## Overview

Expose a per-file coverage ledger in the existing additive `review-report`
output so workflow consumers can distinguish reviewed files, intentional
exclusions, and files selected but not analyzed. Preserve aggregate coverage,
the schema version, permissions, and source-data boundaries.

## Architecture decisions

- Derive statuses from the collected PR file list, existing legacy-filter
  result, selected review list, and `ReviewResult.filesReviewed`.
- Keep classification pure and deterministic; do not add provider calls or
  infer success from finding count.
- Add the ledger to the existing `coverage` object and keep schema version 1
  because the change is additive.
- Cap serialized file-detail size and report truncation and omitted entry count;
  GitHub limits outputs to 1 MB per job.
- Do not add a separate PR comment table; consumers already have
  `review-report`.

## Task list

### Phase 1: Coverage contract

- [x] Add the closed per-file status/reason types and pure classifier.
- [x] Add report serialization tests for every classification path.
- [x] Wire the classifier into the existing review-report build path.

### Checkpoint: Contract

- [x] Every file appears once, with correct status/reason.
- [x] Existing aggregate fields and schema version remain stable.

### Phase 2: Docs and release verification

- [x] Document the additive `coverage.files` shape and reason semantics.
- [x] Run required lint, typecheck, and tests; build both bundles.
- [x] Smoke-run the rebuilt review bundle under the Actions contract.
- [x] Review the final diff for security, output size, and compatibility.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Misclassifying overlapping filters | Medium | Match the existing filtering order and test each boundary. |
| A selected file is absent after a group failure | High | Report `not-analyzed` with `review-group-failed`; never count it excluded. |
| Large report output | Low | One short status/reason record per already-listed file; add no diff/source content. |

## Open questions

- None for the bounded prototype. Direct maintainer validation remains a follow-up.
