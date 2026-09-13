# Constraints

- Frozen action paths, input names/defaults, output and marker formats; additive surfaces only (docs/v1-interface-contract.md).
- Strict TypeScript, Biome, tests with code, docs in the same PR, both bundles rebuilt and smoke-run when source changes (AGENTS.md, CLAUDE.md).
- No unrelated user changes; no attribution trailers; English repository-authored documents and PRs.
- Read-only untrusted analysis and secret redaction; existing documentation is a claim to verify, not proof of isolation (docs/security-model.md).
- Scheduled authorization covers only bounded low/medium-risk evidenced BUILD recommendations. Security architecture, speculative features and broad redesign require a new human decision.
- Source/default ref, committed bundles, tag/release are distinct surfaces. Deployment/rollback must be verified before release; no bypassing protection or approvals.

Operational ownership, canary consumers, production health telemetry and tested rollback procedure: UNKNOWN pending audit.
