# Implementation Plan: Weekly research skill

## Overview

Add a project skill, `weekly-research`, that a maintainer (or a schedule) runs
once a week. It assembles a small research team, scans GitHub, the wider web,
and curated lists (goodailist.com, awesome lists) for new tools, libraries, and
repositories that could improve this code-review engine, then turns the best
bounded finding into a plan, an implementation, a test run, and a pull request.

## Architecture decisions

- The skill lives in `.claude/skills/weekly-research/SKILL.md`. The `skills/`
  directory at the repository root holds review skills consumed by the engine at
  runtime and must not be mixed with maintainer skills.
- Reuse the existing `researcher` agent definition instead of adding a new one.
  The skill only varies the scope prompt per scout.
- Three scouts run in parallel (GitHub, web, curated lists). The orchestrator is
  the fourth participant but does not research, so concurrency never exceeds
  three delegated agents at once. No scout writes to the repository.
- Fetched content is untrusted data. Scouts return structured candidates only;
  the orchestrator verifies every URL and licence before anything is recorded.
- Output is a dated report in `docs/research/weekly-YYYY-MM-DD.md` plus a pointer
  in `docs/index.md` and `.product-intelligence/state.json`.
- Automation authority follows `.product-intelligence/CONSTRAINTS.md`: only
  bounded, evidenced, low or medium risk items are built. Security architecture,
  new runtime dependencies, frozen interface changes, and speculative features
  are recorded as recommendations for a human decision.
- A guard test pins the skill contract (frontmatter, sources, concurrency cap,
  untrusted-input rule, gates, referenced files) so it cannot drift silently.

## Task list

### Phase 1: Skill

- [x] Write `SKILL.md` with preflight, research team, synthesis, plan,
      implement, test, and PR phases plus failure handling.
- [x] Define the candidate schema, scoring rubric, and BUILD eligibility rules.

### Checkpoint: Contract

- [x] Skill names the three sources, the concurrency cap, and the human gate.

### Phase 2: Guard test and docs

- [x] Add `tests/weekly-research-skill.test.ts`.
- [x] Register the skill in `docs/index.md` and add a CHANGELOG entry.

### Phase 3: Verification

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` green.
- [x] No `src/` change, so the dist bundles are untouched.
- [x] Open the pull request.

## Out of scope

- Creating the recurring schedule itself. The skill documents how to schedule it
  (`/schedule`), but registering a schedule is the maintainer's decision.
- Auto-merging. The skill stops at an open pull request.
