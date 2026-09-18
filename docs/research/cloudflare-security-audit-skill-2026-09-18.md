# Cloudflare `security-audit-skill` research — 2026-09-18

## Decision summary

Cloudflare's current `main` is `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (commit date 2026-09-14; confirmed against remote `refs/heads/main` on 2026-09-18). The project documents a six-phase audit workflow with explicit guidance/full-audit modes, coverage tracking, adversarial finding validation, independent record verification, and structured outputs.

The best bounded addition to this repository is to render security evidence already present in the normalized finding model into the full Markdown audit report: source, sink, ordered attack-path text, and evidence file/line where available. This does not reproduce Cloudflare's full audit pipeline or its stricter finding schema. It does not change the quality gate, confirmation behavior, permissions, or public JSON contract.

## Evidence and implications

### Observed

- Cloudflare's README describes six phases from reconnaissance and coverage-led hunting through validation, structured findings, independent verification, and target-neutral reporting.
- Its report schema requires an ordered `entrypoint` / `propagation` / `sink` trace with file and line for confirmed findings, and uses a different shape for unresolved leads.
- Its latest commit on 2026-09-14 clarifies the boundary between guidance and a full audit.
- In `action-code-review` at `fe7d406`, `SecurityFinding` already has `source`, `sink`, and `attackPath`; `SecurityEvidence` has optional `file` and `line`; the Pi prompt requests source and sink. `buildFullAuditReport` currently renders only evidence type and description (the finding's primary file/line is shown separately).
- One public Cloudflare issue, #5, reports unreliable automatic skill activation in an overlapping skill pack and asks for a direct command. It is one qualitative report, not a demand estimate.

### Inferred

Showing already-normalized evidence context in the full audit Markdown should make a finding easier to verify from its artifact. This is a small product improvement supported by a concrete local gap. No market-demand conclusion follows.

### Why not copy the whole workflow

The reference is an interactive multi-agent skill with extensive coverage ledgers, persistent prior-run logic, strict execution sandboxing, and several report artifacts. This GitHub Action already has bounded PR workflows, normalized findings, quality gates, fingerprints, SARIF, security conclusion metadata, and a machine-readable regular-review report. Importing cross-run state, changing verdict semantics, or changing the execution boundary would exceed this task and several are explicitly unresolved in local product constraints.

## Opportunity score and recommendation

Opportunity `opp-20260918-security-report-evidence-context` scores 64/100 raw, 52.48 confidence-adjusted, with S effort and a PROTOTYPE recommendation. Strategic fit and feasibility are strong; market evidence and differentiation are weak because no local user request was found and the feature is mostly a report usability improvement.

The user explicitly authorized research, ideation, and implementation of a suitable feature. That authorizes this local prototype and its tests/docs, not broader roadmap status, publishing, or release actions.

## Research team

Three independent, read-only Claude Code workers reviewed the source and challenged transferability:

| Worker | Assignment | Session | Result |
|---|---|---|---|
| Architecture researcher | Current workflow, schema, validators, recent design | `8dac987e-345a-4eb2-ba97-94ef588eaa19` | Identified the trace/report contract and cautioned against importing orchestration wholesale. |
| Transferability analyst | Compare existing security implementation and bounded opportunities | `906d88fb-e441-4af6-b507-29affad35df3` | Found existing gates and confirmation; proposed trace-backed evidence, while excluding policy changes. |
| Adversarial opportunity reviewer | Challenge value, duplication, constraints, and demand evidence | `b1591cfd-c3f3-427e-94cd-b8353fe07433` | Rejected verdict/coverage-ledger expansion as duplicate or policy-sensitive; found no broad demand evidence. |

Codex checked the decisive local report/model code independently and narrowed the implementation to rendering existing optional fields without changing acceptance policy.

## Sources

- [Cloudflare README at reviewed revision](https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/README.md)
- [Cloudflare report schema at reviewed revision](https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit/report-schema.json)
- [Cloudflare latest reviewed commit](https://github.com/cloudflare/security-audit-skill/commit/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8)
- [Cloudflare issue #5](https://github.com/cloudflare/security-audit-skill/issues/5)
- [Local feature opportunity](../../.product-intelligence/opportunities/2026-09-18-security-report-evidence.json)

## Unknowns

Detection precision/recall, production adoption, user demand in this repository, and whether optional attack paths are consistently populated remain unknown. No live scan or comparative quality benchmark was run.
