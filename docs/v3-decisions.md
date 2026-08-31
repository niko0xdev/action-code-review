# V3 Open Questions - Decision Record

Resolved 2026-08-31 by Hermes Agent (self-decided based on report `docs/v3-prompt-research.md`).

## Q1. Static analyzer binaries - bundle or require?

**Decision:** Hybrid.
- **Bundle** biome + ruff in the action Docker image (FE/BE/Python stacks).
- **Graceful skip** for swiftlint/ktlint/sqlfluff if not present in consumer's PATH.

**Rationale:** Biome (~10MB) + Ruff (~20MB) are lightweight single-binary tools with zero
runtime deps. They cover the highest-traffic stacks (React/NextJS, NodeJS, Python).
Swiftlint/Ktlint are larger, platform-specific, and many consumers will have them via
`package.json`/Gradle already. Graceful skip preserves backward compat and avoids image bloat.

## Q2. Backward compat for `FINDING_LIMITS` with new category vocabulary?

**Decision:** Bucket unknown categories to `low` severity + emit a one-time warning.

**Rationale:** Dropping silently (option A) hides harness bugs. Deprecation warnings
per-PR (option B) spam the summary. Bucketing to `low` keeps the finding visible for
telemetry while honoring the severity cap (`FINDING_LIMITS.low = 5`).

## Q3. Expose `toolFindings` in GitHub review summary?

**Decision:** Yes - in a collapsible `<details>` section at the bottom of the summary.

**Rationale:** Transparency wins long-term. Users can verify what static analysis ran,
audit false positives, and tune their `.ruff.toml`/`.biome.json` config. Collapsible
keeps the headline summary tight. Mirrors how CodeRabbit and PR-Agent show tool results.

## Q4. Two-pass review cost ceiling?

**Decision:** 1.5x cost multiplier with hard cap **$0.50 USD** per review, opt-in only.

**Rationale:** 1.3x is too tight (defeats the purpose when the verify pass is short);
2x is too generous. 1.5x is the sweet spot PR-Agent uses. Hard cap protects against
runaway cost on huge PRs that opt-in accidentally.

## Q5. SQL detection - false-positive guard?

**Decision:** Option B - require raw SQL in PR diff matching `\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|MERGE|TRUNCATE)\b` (case-insensitive, multi-line).

**Rationale:** Most false positives come from repos that have static `.sql` files for
migrations but no SQL in the PR itself. Requiring actual SQL in changed files is the
strongest signal that review needs to fire.

## Cascade effect on Phase 2 (prelint)

- Q1 -> `prelint.ts` uses `findBinary` check; missing binary is not error.
- Q2 -> `validator.ts` bucketing affects how prelint findings get validated too.
- Q3 -> `review.ts` rendering needs to know about `toolFindings` shape.
- Q4 -> Phase 2 doesn't implement verify pass yet, but the cost-tracker hook should be
  designed to extend later.
- Q5 -> SQL profile detection logic refined in Phase 2 if needed.

Implementation notes tracked in `docs/v3-prompt-research.md` are superseded by these
decisions. Update research doc to reference this ADR after Phase 2 ships.
