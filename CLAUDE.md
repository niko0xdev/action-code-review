# Agent rules

## Commits and PRs

- Never add co-author trailers (`Co-Authored-By`, `Signed-off-by`,
  `Generated with/by`) to commit messages or PR bodies. The user is the
  only author.
- PR title and body never mention any model name.
- Branch naming: `feat/`, `fix/`, `chore/`, `docs/`, `test/` + short slug
  (example `feat/rich-summary`).

## Code

- Follow `biome.json` and strict TypeScript. Shortest working diff wins.
- No new dependency for what a few lines can do.
- Tests ship with the code (TDD). `pnpm test` green before push.
- Docs change in the same PR when adding, changing, or removing any
  feature (`docs/index.md` points at what to update).

## Before push when `src/` changed

```bash
pnpm build   # rebuilds pr-review/dist/index.js + pr-content/dist/index.js
```

Verify the bundle contains the change (`grep` the dist), then smoke-run
`node pr-review/dist/index.js`. Stale dists break consumers silently.
