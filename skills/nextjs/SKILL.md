---
name: nextjs
description: Next.js (v13+) code review covering App Router, Server Components, Server Actions, caching, middleware, and Next.js-specific performance and security pitfalls. Use when reviewing pages, route handlers, layouts, or anything Next.js-specific.
---

# Next.js Code Review

When reviewing Next.js code, prioritize:

## Server vs Client Components

- **Default to Server Components**: add `'use client'` only when component needs state, effects, browser APIs, or event handlers.
- **Boundary**: `use client` at the smallest possible leaf — never wrap entire pages.
- **Server-only modules**: import secrets, DB clients, file system only in Server Components. Never in client bundles.
- **Props serialization**: Server → Client props must be JSON-serializable. No Date, Map, Set, functions, class instances.

## App Router (v13+)

- **Layouts vs Pages**: layouts persist across navigation; pages re-render. Use layouts for shared chrome.
- **Loading & Error UI**: `loading.tsx` for Suspense boundaries, `error.tsx` for error boundaries. Without them, errors bubble to root.
- **Route Handlers**: `route.ts` files — never mix GET and POST handlers with side effects; each HTTP verb should be a separate exported function.
- **Dynamic routes**: `[id]/page.tsx` — params are async (Next.js 15+) — `const { id } = await params;` not `params.id`.

## Data Fetching

- **`fetch()` caching**: Next.js extends `fetch()` with `{ next: { revalidate: 60 } }` or `{ cache: 'force-cache' }`. Plain `fetch()` is **not** cached by default in App Router.
- **`cache()` wrapper**: for non-fetch deduplication, wrap with `import { cache } from 'react';` then `const getUser = cache(async (id) => ...)`.
- **Parallel fetching**: `Promise.all([getUser(), getPosts()])` not sequential awaits.
- **No data fetching in Client Components for static data**: lift to Server Components.

## Server Actions

- **Form actions**: `async function createPost(formData: FormData) { ... }` exported from `'use server'` file or inline.
- **Always revalidate**: after mutation, call `revalidatePath('/posts')` or `revalidateTag('posts')`.
- **Auth in Server Actions**: never trust client. Re-check auth on server every time.
- **Input validation**: validate on server, never trust client form values.

## Performance

- **Image component**: use `next/image` not `<img>`. Required for automatic optimization, lazy loading, responsive sizes.
- **Font optimization**: use `next/font` to avoid FOUT and large font payloads.
- **Script loading**: `next/script` with `strategy="lazyOnload"` for third-party scripts.
- **Dynamic imports**: `const Heavy = dynamic(() => import('./Heavy'), { ssr: false })` for client-only heavy components.
- **Streaming with Suspense**: wrap slow data fetches in `<Suspense fallback={...}>` so above-the-fold content renders immediately.

## Caching Pitfalls

- **Default cache changed**: Next.js 15 made `fetch()` **non-cached by default**. Opt-in caching required.
- **Static vs Dynamic**: pages calling `cookies()`, `headers()`, `searchParams` are dynamic. Mark dynamic explicitly or use `dynamic = 'force-static'` carefully.
- **`unstable_cache`**: for non-fetch data, use `unstable_cache` with explicit tags.

## Security

- **Environment variables**: only `NEXT_PUBLIC_*` exposed to client. Never put secrets in non-prefixed vars.
- **Middleware**: runs on Edge runtime by default — no Node.js APIs (no `fs`, no native modules). Use for auth checks, redirects, headers.
- **CSP headers**: set via `next.config.js` `headers()` function. Avoid `'unsafe-inline'` and `'unsafe-eval'`.

## Common Issues to Flag

- `'use client'` directive missing but component uses `useState`/`useEffect` → won't compile.
- Secrets in `NEXT_PUBLIC_*` env vars → exposed to client bundle.
- `cookies()` or `headers()` used without `dynamic = 'force-dynamic'` → Next.js 15 errors at build.
- Missing `revalidatePath` after Server Action → stale UI.
- Direct DB query in Client Component → bundle bloat + secrets leak.
