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

- **`diff`** (Default PR security mode): Fast, cost-efficient security analysis over PR changed files, hunks, and dependencies. Combines static scanners (Semgrep, secret scan, dependency scan) with skill-routed Pi reasoning and quality gating.
- **`lite`**: Lightweight repository-wide security scan focusing on critical surfaces (auth, API boundaries, crypto, CI/CD).
- **`balanced`**: Standard repository security audit across all domain categories with evidence collection and SARIF generation.
- **`deep`**: Exhaustive security audit evaluating data flows, indirect attack chains, and multi-file vulnerabilities.
- **`confirm`**: Independent verification pass for high-risk findings without anchoring to discoverer reasoning.

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
| `security-sarif` | Generate SARIF v2.1.0 output (`nim-security.sarif`) | `true` |
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

Skills are dynamically and deterministically routed by the `SecuritySkillSelector` based on the PR risk classifier output.

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
      - uses: actions/checkout@v4
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
      - uses: actions/checkout@v4
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
