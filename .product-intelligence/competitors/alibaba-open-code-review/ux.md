# UX: Alibaba `open-code-review`

## Status: UNKNOWN — no hands-on session performed

No installation, CLI run, GitHub Action run, or session-viewer session was
performed against Alibaba `open-code-review` during this review (2026-09-18).
This file records what can and cannot be said.

## Observed surface (OBSERVED, from repository contents only)

- A session viewer exists and received a header restyle in `6ada4acf`
  (2026-09-18), which implies a human-facing review-session browsing surface.
- The README documents a `--format json --output <file>` CLI path, so a
  file-producing non-interactive mode exists.
- A GitHub Action form exists with documented permissions including
  `contents: write` for the opt-in thread-resolution mutation.

These are structural observations about shipped surfaces. They are **not**
usability findings: nobody ran the tool, so nothing can be said about
onboarding friction, review-comment quality, error clarity, latency, or
accessibility.

## What must not be asserted

- Any claim that the competitor's UX is better, worse, faster, or clearer.
- Any invented observation about its output formatting, comment layout, or
  viewer ergonomics.

## How to close this gap

Run the CLI and the action against a scratch pull request, capture the produced
JSON and the posted comments, and then record dated observations. Until that
happens, UX is UNKNOWN and must not be scored.
