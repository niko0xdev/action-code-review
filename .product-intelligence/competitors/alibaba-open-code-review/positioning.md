# Positioning: Alibaba `open-code-review`

## Observed positioning (OBSERVED)

The README frames the product around two pillars: a "deterministic
engineering" layer and an "agent architecture". It also documents a
`json` output format for review results and a session viewer. Read as claims,
not verified outcomes.

## Relative to this repository

| Axis | This repo | `open-code-review` |
|---|---|---|
| Primary shape | GitHub Action with frozen `pr-review` / `pr-content` entry paths | CLI + GitHub Action |
| Machine-readable result | Prose `review-summary` only (before this change) | Documented `--format json --output result.json` |
| Explicit partial-coverage state | `reviewStatus` + `failedGroups` internally | Requested publicly via issue #367, closed via #520 |
| Deterministic pre-analysis | Opt-in prelint; findings feed the prompt | Claimed as a core architectural pillar |

## Differentiation read (INFERRED)

The competitor appears to position on breadth of agent capability and on
machine-readable integration; this repository's differentiators remain its
frozen consumer interface, least-privilege permission contract, and explicit
honest-incomplete-state handling. Machine-readable output is therefore parity
work, not a differentiator.

## Not established

Market positioning versus other vendors, pricing tier, target segment, and
competitive win/loss evidence are **UNKNOWN**. No marketing material beyond the
repository README was consulted.
