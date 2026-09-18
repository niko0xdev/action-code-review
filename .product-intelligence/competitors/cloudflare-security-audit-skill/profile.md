# Cloudflare `security-audit-skill`

## Identity and snapshot

- **Repository:** https://github.com/cloudflare/security-audit-skill
- **Type:** Open-source coding-agent skill for source-grounded security audits.
- **License:** MIT, observed in `LICENSE` at reviewed revision.
- **Reviewed ref:** `main` at `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.
- **Commit date:** 2026-09-14. Remote `refs/heads/main` was checked on 2026-09-18 and matched this revision.
- **Evidence basis:** official README, skill source, JSON schema, validator source, recent commit history, and public issues. No hosted product, pricing, or detection-quality benchmark was tested.

## Summary

The repository provides a six-phase, agent-coordinated audit workflow: reconnaissance, coverage-led hunting, candidate validation, structured findings, independent record verification, and reporting. It distinguishes guidance from full-audit mode, requires explicit scope and execution boundaries, and records partial work instead of implying that one pass exhausts a repository.

The strongest transferable idea for `action-code-review` is evidence presentation: Cloudflare's finding contract carries ordered source traces and file locations, while this action already normalizes source, sink, and evidence-location fields but its full Markdown audit report omits them. This is a reporting opportunity, not evidence that Cloudflare has better detection quality.

## Unknowns

- Real-world finding precision and recall, cost, latency, adoption, and enterprise usage are unverified.
- Cloudflare's README reports that repeated runs found substantially more vulnerabilities than one run; this is a company-reported result and was not reproduced.
- Demand beyond the small number of visible public issues is unknown.
