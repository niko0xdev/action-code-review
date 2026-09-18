# User experience

## Observed

- Installation is documented through `npx skills add` with an optional global install (`README.md`, lines 229-242).
- Users can ask for a focused security question or a full codebase audit. Guidance mode avoids automatically creating audit artifacts; full-audit mode writes reports and structured records to a new directory outside the target by default (`skills/security-audit/SKILL.md`, lines 10-17 and 44-52).
- Full-audit output includes a coverage ledger, findings JSON, a main report, detailed findings, and unresolved validation leads (`skills/security-audit/SKILL.md`, lines 54-66; `VALIDATION-AND-REPORTING.md`, lines 151-182).

## Assessment and unknowns

The explicit mode boundary and external-by-default output directory make artifact creation predictable. Setup friction, completion time, and usability across coding-agent platforms were not tested. One public issue reports that automatic skill activation can be unreliable when another skill overlaps; this is a single user's report, not a measured usability trend.
