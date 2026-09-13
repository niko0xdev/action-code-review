# Audit team handoff — 2026-09-13

## Decision

The next release should improve review truth before expanding agent count or
adding offensive testing. The current architecture already has useful building
blocks: deterministic scanners, normalized findings, a quality gate,
confirmation, SARIF, and GitHub publishing. The highest-value gaps are at the
boundaries where incomplete work can look complete and where review state is
not preserved across PR updates.

This pass prioritizes two correctness defects in the current PR:

1. Repository-wide security profiles must not silently downgrade to a diff
   review when their full-audit adapter is unavailable.
2. `auto-approve-when-resolved` must read review-thread resolution through the
   supported GitHub GraphQL `reviewThreads` connection and fail closed when the
   state cannot be established.

## Audit findings

| Priority | Finding | Decision |
|---|---|---|
| P0 | `lite` / `balanced` / `deep` could fall back to a diff engine; scheduled runs can have an empty `changedFiles` set and therefore appear clean without a repository audit | Fix now; missing full-audit support becomes incomplete/failed |
| P1 | The action previously failed only on the configured finding threshold; an incomplete security run could still leave CI green | Fix now; incomplete security conclusions fail closed |
| P1 | Review-thread resolution used a REST route that is not the GitHub review-thread contract | Fix now with GraphQL pagination |
| P1 | The security-specific Pi execution path does not yet reuse all hardening in the general Pi harness | Next trust-boundary PR |
| P1 | General review findings lack the evidence/provenance contract already present in security findings | Next product-quality phase |
| P1 | PR pushes are reviewed as isolated runs; there is no stable `new / open / resolved / regressed` finding lifecycle | Next product-quality phase |
| P2 | Deterministic security coverage is still thin around secrets, dependency advisories, and GitHub Actions workflows | Expand with mature scanners rather than more custom regexes |

## Scanner and skill research

GitHub repository metadata was checked on 2026-09-13. Stars are a popularity
signal, not a quality guarantee; maintenance, licensing, deterministic output,
and CI fit are more important for integration decisions.

| Project | Intended role | License | Stars observed | Recommendation |
|---|---|---:|---:|---|
| [Semgrep](https://github.com/semgrep/semgrep) | SAST | LGPL-2.1 | 16,611 | Core; pin version/rules and record scanner provenance |
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Secret detection | MIT | 29,284 | Core CLI secret scanner |
| [OSV-Scanner](https://github.com/google/osv-scanner) | Lockfile/package vulnerability analysis | Apache-2.0 | 11,019 | Core SCA layer |
| [zizmor](https://github.com/zizmorcore/zizmor) | GitHub Actions security | MIT | 6,491 | Core when workflow/action files change |
| [actionlint](https://github.com/rhysd/actionlint) | GitHub Actions correctness | MIT | 4,219 | Core workflow validation |
| [Trivy](https://github.com/aquasecurity/trivy) | Filesystem/IaC/license/dependency audit | Apache-2.0 | 37,889 | Optional deep profile to avoid routine overlap/cost |
| [Trail of Bits skills](https://github.com/trailofbits/skills) | Differential review/static-analysis methodology | CC-BY-SA-4.0 | 7,055 | Use as external methodology; do not copy skill text into this MIT repository without satisfying the license |
| [secpriv-skill](https://github.com/facebookresearch/secpriv-skill) | Detector/validator security methodology | MIT | 8 | Experimental reference; adoption is currently too low for a core dependency |

CodeQL remains useful as an optional GitHub-integrated semantic-analysis
provider, especially where the repository already has the required GitHub
security features. It should not be required for the base OSS action.

Dynamic application scanners and exploit tooling are intentionally outside the
default PR-review path. They belong in an opt-in integration against an
authorized deployed test environment. Source, dependency, secret, workflow,
and supply-chain evidence should be made reliable first.

## Recommended profiles

**Diff:** Gitleaks, changed-file Semgrep, actionlint/zizmor when workflow files
change, OSV-Scanner when dependency manifests or lockfiles change, then agent
review over normalized evidence.

**Balanced:** Diff coverage plus broader Semgrep/OSV scope and an independent
false-positive/evidence validation pass.

**Deep:** Balanced coverage plus full-repository SAST, optional Trivy/CodeQL,
and repository-wide reasoning. A missing mandatory engine or scanner must be
reported as incomplete rather than clean.

## Update sequence

1. **Current PR — audit truth and lifecycle integrity:** fail closed on missing
   full-audit support and incomplete security runs; use GitHub GraphQL review
   threads with pagination and root-author attribution.
2. **Scanner trust PR:** pin Semgrep execution/rules, add Gitleaks and
   OSV-Scanner, then zizmor/actionlint for workflow changes. Normalize every
   result into the existing finding ledger with version/config provenance.
3. **Execution-boundary PR:** route security reasoning through the same
   hardened execution primitive as general review, with minimal environment,
   read-only tools, output limits, timeout, and process-group cancellation.
4. **Review-state PR:** add stable finding identity plus
   `new / open / resolved / regressed` state across PR heads. Add PR-scoped
   workflow concurrency/cancellation to avoid spending on superseded reviews.
5. **Evidence contract PR:** extend general findings with source, rule/skill,
   evidence, verification state, and base/head location or content identity.
6. **Trusted scoped-policy PR:** support repository and path-specific review
   rules loaded from a trusted base revision or configured trusted source.

The broader benchmark and product roadmap remain in
[`code-review-deep-research.md`](code-review-deep-research.md) and
[`improvement-roadmap.md`](improvement-roadmap.md). This document records the
2026-09-13 audit-team delta and the implementation order selected from it.
