# Next.js Example Project

This example shows how to onboard a simple Next.js application and wire it up with the AI Code Review GitHub Action.

## Getting Started

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Running the Action

Add the following workflow inside your Next.js repository to reuse the action from this monorepo:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: niko0xdev/action-code-review/pr-review@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

## Project Structure

```
examples/nextjs
├── app
│   ├── api/hello/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── public
│   └── vercel.svg
├── next.config.mjs
├── package.json
├── tsconfig.json
└── README.md
```
