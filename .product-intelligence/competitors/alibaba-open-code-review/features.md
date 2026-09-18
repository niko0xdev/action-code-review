# Features: Alibaba `open-code-review`

Evidence labels: OBSERVED (read in a primary source at the stated revision),
SUPPORTED (observed + short inference), UNKNOWN (not established).

## Machine-readable review result — OBSERVED / schema stability — UNKNOWN

README documents `ocr review --format json --output result.json`, so the CLI
documents a JSON review output. That the output schema is **stable or
versioned** is **UNKNOWN**: the README command only proves JSON output exists,
not that its shape is guaranteed across releases.

## Immutable review manifest request — OBSERVED (issue)

Issue #367 (opened 2026-07-14) asks for a machine-readable immutable review
manifest and explicit partial-coverage state. It was closed via PR #520.
Whether the closure fully satisfies the request in shipped code is
**INFERRED**, not verified.

## Opt-in resolution of own outdated review threads — OBSERVED (commit `cb6ea262`, 2026-09-17)

Opt-in, default off; decides based on GitHub `isOutdated` plus vetoes. The
action documentation states the mutation requires `contents: write`. **Not
applicable to this repository** without breaking its least-privilege contract.

## Duplicate incremental-review comment prevention — OBSERVED (commit `ed274d58`, 2026-09-17)

Prevents overlapping duplicate incremental-review comments. Mechanism not
independently verified.

## Per-group token budget — OBSERVED (commit `8d57bc9e`, 2026-09-17)

Enforces a token budget within a running group. Compared with this repository,
which bounds total prompt context and the optional verify pass but not
per-group execution.

## Global code-search result limit — OBSERVED (commit `f6f0f79`, 2026-09-17)

Enforces a global limit on code-search results. Bounds tool output cost; this
repository bounds prompt context instead.

## Not established — UNKNOWN

Finding precision/recall, false-positive rate, cost per PR, latency, supported
languages, model providers, self-hosting story, and enterprise features beyond
the README were not verified.
