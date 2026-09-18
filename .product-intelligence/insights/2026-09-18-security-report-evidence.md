# Security report evidence should be easier to verify

Insight ID: `ins-20260918-security-report-evidence`

Signals: `sig-20260918-cloudflare-audit-evidence`, `sig-20260918-security-report-evidence-gap`.

**OBSERVED:** Cloudflare's current source schema asks confirmed findings to carry ordered, located evidence. This action's full security report currently prints only each evidence item's type and description, while its normalized finding type already carries `source`, `sink`, `attackPath`, and evidence `file`/`line`; its prompt also requests source and sink.

**INFERRED:** Showing those already-available values in the full Markdown report should make it easier for a maintainer to trace a reported issue back to code without changing which findings pass the quality gate. This is an implementation opportunity, not a demand trend.

**Counter-evidence:** Inline comments, SARIF, and `security_conclusion` already expose parts of a finding; this proposal only improves the full Markdown artifact. No user request for richer traces was found in this repository, and Cloudflare's richer trace schema does not prove better detection quality.

**Confidence:** 0.82. Source and renderer behavior are directly inspectable. Consumer pain and adoption impact remain UNKNOWN.

**What would change the conclusion:** evidence that the engine fields are routinely absent or misleading, or user feedback preferring a different report format.
