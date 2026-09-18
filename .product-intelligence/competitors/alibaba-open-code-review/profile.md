# Competitor profile: Alibaba `open-code-review`

## Identity

- Project: `open-code-review` (`ocr`)
- Owner: Alibaba
- Repository: https://github.com/alibaba/open-code-review
- Reviewed revision: `main` at `6ada4acf` (2026-09-18)

## What it is (OBSERVED)

An AI code-review tool distributed as a CLI plus a GitHub Action, positioned
around "deterministic engineering + agent architecture". Its README documents
a `ocr review --format json --output result.json` invocation, i.e. a
first-class machine-readable review result (OBSERVED on the README at the
reviewed revision).

## Overlap with this repository (SUPPORTED)

Both projects review pull requests with an LLM-driven agent, both run
deterministic pre-analysis before the model, and both publish findings back to
GitHub. The overlap is strong enough that capability decisions in this
repository should explicitly account for it.

## License (OBSERVED)

Apache-2.0, observed on the repository's `LICENSE` file on 2026-09-18:
<https://github.com/alibaba/open-code-review/blob/main/LICENSE>

## Adoption, popularity, funding and pricing

**UNKNOWN.** Stars, downloads, number of production consumers, funding, and
pricing model were not verified in this pass. Do not state values for these
without a new primary-source check. License terms are recorded separately above.

## Confidence

- Product exists, is public, and ships the named artifacts: **OBSERVED**.
- License is Apache-2.0: **OBSERVED** (repository `LICENSE` file).
- Claims about its architecture quality or review accuracy: **UNKNOWN** (README
  claims were not independently reproduced).
