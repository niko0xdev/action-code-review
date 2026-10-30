# Security Review & Audit Capability

## 1. Architecture

`action-code-review` provides a multi-profile security engine powered by Pi and Piolium harnesses, combining pre-LLM deterministic classification, curated cybersecurity skills, static analysis scanners, and structured false-positive validation.

```
                         GitHub Event
                              │
                              ▼
                     action-code-review
                              │
                     Event / Mode Router
                              │
            ┌─────────────────┼──────────────────┐
            │                 │                  │
            ▼                 ▼                  ▼
       Code Review       Security Diff      Security Audit
         Profile             Profile            Profile
            │                  │                  │
            │            Static Analysis      Piolium
            │            + Skill Router       Lite/Balanced/
            │            + Pi Reasoning       Deep/Confirm
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │
                               ▼
                           Pi Runtime
                               │
                               ▼
                         Model Provider
                               │
                               ▼
                     OpenAI-compatible LLM
                               │
                               ▼
                       Finding Normalizer
                               │
                ┌──────────────┼───────────────┐
                ▼              ▼               ▼
          Inline Review   Sticky Summary      SARIF
```

---

## 2. Execution Profiles

- **`diff`** (Default PR security mode): Fast, cost-efficient security analysis over PR changed files, hunks, and dependencies. Combines static scanners (Semgrep, secret scan, dependency scan, OSV dependency-CVE scan) with skill-routed Pi reasoning and quality gating.
- **`lite`**: Lightweight repository-wide security scan focusing on critical surfaces (auth, API boundaries, crypto, CI/CD).
- **`balanced`**: Standard repository security audit across all domain categories with evidence collection and SARIF generation.
- **`deep`**: Exhaustive security audit evaluating data flows, indirect attack chains, and multi-file vulnerabilities.
- **`confirm`**: Independent verification pass for high-risk findings without anchoring to discoverer reasoning.

Repository-wide profiles require a compatible Piolium adapter exposing
`runAudit()`. If that adapter is unavailable, the run is marked incomplete and
fails closed; it is never silently downgraded to a diff-only review.

---

## 3. Public Inputs & Outputs

### Inputs

| Input | Description | Default |
|---|---|---|
| `mode` | Execution mode (`auto`, `review`, `security`, `agent`) | `auto` |
| `security-profile` | Security profile (`diff`, `lite`, `balanced`, `deep`, `confirm`) | `diff` |
| `security-min-severity` | Minimum severity to publish (`critical`, `high`, `medium`, `low`, `info`) | `medium` |
| `security-fail-on` | Fail action if findings reach severity (`critical`, `high`, `medium`, `low`, `info`, `none`) | `critical` |
| `security-confirm-findings` | Run validation pass on eligible high-risk findings | `true` |
| `security-inline-comments` | Publish validated findings as inline PR comments | `true` |
| `security-sticky-comment` | Publish/update single security summary comment | `true` |
| `security-sarif` | Generate SARIF v2.1.0 output (`nim-security.sarif`; `security_sarif_path` is empty if the write failed) | `true` |
| `security-max-findings` | Maximum findings to publish to PR | `20` |
| `security-risk-threshold` | Risk threshold for escalating analysis | `high` |

### Outputs

| Output | Description |
|---|---|
| `security_findings` | Normalized JSON array of validated security findings |
| `security_findings_count` | Number of validated security findings |
| `security_risk` | Overall security risk level (`critical`, `high`, `medium`, `low`, `none`) |
| `security_sarif_path` | Filesystem path to the generated SARIF report |
| `security_report_path` | Filesystem path to the generated markdown audit report |
| `security_conclusion` | Detailed conclusion metadata JSON |
| `review-summary` | Human-readable summary string |

---

## 4. Curated Cybersecurity Skills Integration

Derived and adapted from `mukul975/Anthropic-Cybersecurity-Skills` under the **Apache-2.0 License**:
- Authentication & Session Integrity (CWE-287, CWE-384, CWE-208)
- Authorization & Access Control / BOLA (CWE-862, CWE-863, CWE-639)
- Injection Prevention (SQLi CWE-89, Command Injection CWE-78, Path Traversal CWE-22)
- SSRF & Webhook Security (CWE-918, CWE-601)
- CI/CD & GitHub Actions Security (CWE-78, CWE-250)
- Supply Chain & Dependency Security (CWE-829, CWE-1357)
- AI & LLM Application Security (CWE-20, CWE-74)
- File Upload & Deserialization Security (CWE-434, CWE-502)

Skills are dynamically and deterministically routed by the `SecuritySkillSelector` based on the PR risk classifier output. Every non-empty render appends a seven-question Review Validation Gate (file, line, source, data flow, impact, fix, false-positive evidence); findings that cannot answer all seven are dropped.

Licence-clean defensive skills (original prose; MIT/Apache sources ported with attribution in code comments, OWASP sheets used as linked references only, never copied verbatim):
- Payment Safety: Race Conditions & Idempotency (CWE-367, CWE-841)
- Client-Side XSS: Contextual Output Encoding (CWE-79, CWE-116)
- Secret Hygiene: Entropy Scan & Allowlisting (CWE-798, CWE-312)
- Cryptographic Hygiene & Randomness (CWE-327, CWE-338, CWE-295)

---

## 5. Threat Model & Prompt Injection Defenses

- **Data vs Instructions**: All repository content, PR diffs, docstrings, and comments are treated as untrusted data.
- **Anti-Prompt Injection System Prompt**: Enforces strict policy boundary prohibiting command execution or instruction override from analyzed code.
- **Secret Redaction**: Automated pattern-based redactor scrubs GitHub tokens, OpenAI keys, AWS credentials, private keys, bearer tokens, and JWTs from comments, step summaries, SARIF, and log streams.
- **Tool Isolation**: Pi operates with restricted, read-only tools (`read`, `grep`, `find`, `ls`).

---

## 6. Workflow Examples

### PR Security Diff Review

```yaml
name: PR Security Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write
  security-events: write

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Run PR Security Review
        uses: niko0xdev/action-code-review/pr-review@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          mode: security
          security-profile: diff
          security-min-severity: medium
          security-fail-on: critical
```

## 7. Audit Report Evidence Context

The full Markdown audit report (`security_report_path`) renders existing
normalized finding fields as additional verification context. All of the
following are conditional and appear only when the engine supplied a
non-empty value:

- **Source** and **Sink** on the finding, shown under `#### Evidence Context`.
- **Attack path**, when `attackPath` has at least one non-empty step. Steps
  render as an ordered list in their existing order under
  `#### Attack Path`. No trace is invented when the array is absent or empty.
- **Evidence location**, prefixed to each evidence item as `[type] file:line`
  when a file is supplied, with `:line` appended only for a positive finite
  integer line. Without a location, the item keeps the plain
  `[type] description` form.

Missing or empty optional fields produce no labels, no headings, and no
placeholder text; the report is unchanged for findings that carry none of
these fields.

These values are LLM-derived and treated as untrusted. Code-like values
(source, sink, attack-path steps, and evidence locations) render as inline
code spans with a fence longer than any backtick run they contain. Freeform
finding prose (titles, classifications, remediation, and evidence
descriptions) renders as single-line Markdown-escaped text: newlines collapse
to spaces and Markdown punctuation, angle brackets, colons, domain dots, and
at-signs, plus leading list markers, are escaped, so a value cannot open a
heading, list, table row, link, bare-URL or bare-domain (`www.`) autolink,
email autolink, or raw HTML block while ordinary text stays readable. The
backslash an autolink guard introduces renders invisibly, so `www.example.com`
and `attacker@example.com` still read normally in the rendered report.
Freeform prose is passed through the secret redaction of §5 *before* this
escaping, because escaping rewrites the underscores and dots that redaction
patterns rely on; the redaction marker is then escaped alongside the rest,
which only adds invisible backslashes, so it still renders as `[REDACTED_…]`.
The complete assembled report still passes through the same report-wide
redaction again as defense in depth.

---

## 8. Scanner Completion Contract (Semgrep)

A Semgrep execution reports `success` only when the CLI exits with code `0`,
no termination signal, an empty `errors` array, and a `results` array in the
JSON output. Malformed records inside `results` are skipped without failing
the run.

Anything else reports `failed` while retaining the valid findings parsed so
far: a missing or non-array `results` envelope, malformed JSON, a nonzero
exit or signal, a non-empty structured `errors` array, a launch failure other
than `ENOENT`, or a 60s timeout. Only a missing binary (`ENOENT`) or an empty
target list reports `skipped`. Error reasons are bounded to 200 characters. A
`failed` scanner marks the workflow conclusion `incomplete` and adds a
`SECURITY REVIEW INCOMPLETE` notice to the sticky summary, so a partial scan is
never presented as a clean pass. The action also fails when the final security
conclusion is incomplete, even when no finding reaches `security-fail-on`.

Input validation and gating notes:

- `mode`, `security-profile`, `security-min-severity`, `security-fail-on`, and
  `security-risk-threshold` are validated against their allowed values. An
  unknown value logs a warning and uses the documented default.
- `security-fail-on` is evaluated against every validated finding, before the
  `security-min-severity` publish gate and the `security-max-findings` cap, so a
  `fail-on` below `min-severity` still fails the run even though those findings
  are not published.
- A failed confirmation pass (`security-confirm-findings`) marks the conclusion
  `incomplete`: unconfirmed high findings remain published, the summary carries
  the incomplete notice, and the action fails.
- The SARIF file name `nim-security.sarif` is unchanged to avoid breaking
  existing upload steps; consume `security_sarif_path` instead of hard-coding it.

WATCH: Semgrep CLI exit-code semantics may vary by version (findings-present
vs findings-absent exits); re-verify the nonzero-exit rule against the pinned
CLI version. WATCH: ruleset or network failures surface as structured `errors`
with exit 0 — coverage can still be partial when only the failing subset is
excluded.

---

### OSV Dependency-CVE Scanner

The `osv-dependency-cve` scanner extracts pinned (name, version) pairs added
in the diff from `package.json`, `package-lock.json`, `pnpm-lock.yaml`,
`requirements*.txt`, and `go.mod`, then queries the public OSV.dev batch API
(`https://api.osv.dev/v1/querybatch`, no token required) for known
vulnerabilities. Findings carry the CVE/GHSA identifier, CVSS-derived severity,
a fixed-version remediation hint when the OSV record provides one, and a link
to the OSV advisory page. Only the npm, PyPI, and Go
ecosystems are covered. Added dependencies are queried in batches of up to 50
(at most 3 batches in flight) and results are merged by index, up to a hard cap
of 500 dependencies per run. `next_page_token` pagination of a single result is
not followed (existing gap). An empty added-dependency list or
`OSV_SCAN_DISABLED=1` reports `skipped`. A batch that errors (network failure or
a non-2xx response) or dependencies beyond the 500 cap report `failed` with the
number of failed batches or unqueried dependencies; findings from everything
that was checked are still published, and `failed` marks the security review
incomplete so it never reads as clean. Adding more than 50 dependencies, such as
a lockfile bump, stays `success` as long as every batch completes.

---

### Scheduled Security Audit

```yaml
name: Security Audit

on:
  schedule:
    - cron: '0 20 * * 0'
  workflow_dispatch:

permissions:
  contents: read
  security-events: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Run Repository Security Audit
        uses: niko0xdev/action-code-review/pr-review@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          mode: security
          security-profile: balanced
```

This scheduled example requires the compatible full-audit adapter described in
the profile contract above. Missing full-audit support fails the run instead of
reporting an empty diff as a successful repository audit.
