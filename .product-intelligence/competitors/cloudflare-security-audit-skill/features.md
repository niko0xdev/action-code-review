# Features

Evidence labels refer to the public source at `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, observed 2026-09-18.

## Observed

- Six phases connect reconnaissance and coverage planning to hunting, adversarial validation, structured findings, independent record verification, and reports (`README.md`, lines 195-205).
- Guidance mode is the default; a full audit and its artifacts require an explicit full-audit request (`skills/security-audit/SKILL.md`, lines 10-17).
- Full audits use a coverage ledger with stable surface/boundary/subsystem/attack-class identifiers and explicit states such as `covered`, `candidate`, `blocked`, `deferred`, and `out_of_scope` (`skills/security-audit/RECONNAISSANCE.md`, lines 90-115).
- Findings have distinct `confirmed`, `needs_validation`, and `rejected` shapes. The confirmed shape includes an ordered entrypoint/propagation/sink trace with file and line, while unresolved candidates require blockers and a validation plan (`skills/security-audit/report-schema.json`, lines 40-73 and 333-358).
- A separate verifier challenges candidate findings; report generation follows structured validation and keeps hardening notes separate from confirmed vulnerabilities (`skills/security-audit/VALIDATION-AND-REPORTING.md`, lines 93-107 and 151-167).
- The repository includes zero-dependency validators for the findings and coverage ledger; input size and collection limits are explicit (`README.md`, lines 202-227; validator sources).
- The latest commit, `c1c8a8c` on 2026-09-14, clarifies the boundary between guidance and full-audit mode and refines hunting guidance (`git show c1c8a8c`).

## Comparison with this product

This repository already has finding normalization, evidence gates, fingerprints, security conclusion metadata, scanner completion reporting, and a machine-readable regular-review report. The full security-audit Markdown report currently includes evidence descriptions but omits `SecurityEvidence.file`/`line` and the normalized `source`/`sink` fields. Rendering those existing values is a small complementary change; it does not reproduce Cloudflare's complete trace schema or its multi-agent audit process.

No claim is made that Cloudflare's process raises finding precision for this product. Its prior-run ledger and OS-enforced sandbox model are not recommended here: those would add state, permissions, or execution-boundary decisions outside this task.
