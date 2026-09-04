---
name: react
description: React (v18+) best practices and common issues for code review. Use when reviewing React components, hooks, state management, JSX, and component lifecycle. Highlights hook rules, state synchronization, re-render patterns, performance anti-patterns, and accessibility.
---

# React Code Review

When reviewing React code, prioritize these categories:

## Hook Rules (CRITICAL)

- **Rules of Hooks**: hooks called only at top level (no loops, conditions, nested functions). Verify with ESLint `react-hooks/rules-of-hooks`.
- **Dependency arrays**: `useEffect`, `useMemo`, `useCallback`, `useEffectEvent` must list every reactive value used inside. Missing deps → stale closures or infinite loops.
- **Stale closures**: `useEffect` that captures state without deps causes UI desync with state.
- **Effect cleanup**: subscriptions, intervals, event listeners must return cleanup function or call `.unsubscribe()` / `clearInterval()`.

## State Management

- **State updates are async**: never read state immediately after `setState()` — use `useEffect` or compute from event.
- **Object/array state**: mutate via spread (`{...state, key: val}`) not direct assignment — React uses Object.is for re-render detection.
- **Derived state**: compute during render (`const filtered = items.filter(...)`), don't store in `useState`. Storing derived state causes sync bugs.
- **Reducer for complex updates**: prefer `useReducer` over multiple `useState` when updates are interdependent.

## Performance

- **Memoization**: `React.memo`, `useMemo`, `useCallback` only when (a) reference equality matters (passed to memoized child, used in deps) or (b) computation is expensive. Premature memoization adds overhead.
- **Key prop**: stable, unique keys for list items. Index keys are OK only if list is static; avoid for reorderable lists.
- **Lazy init**: `useState(() => expensiveComputation())` for costly initial values.
- **Refs for non-render values**: use `useRef` for timers, DOM nodes, previous values — avoid storing in state (causes extra renders).

## Re-render Traps

- **Inline objects/functions**: `<Child style={{ color: 'red' }} />` creates new object each render → child re-renders. Hoist or memoize.
- **Context value identity**: `const value = { a, b }` in render causes all consumers to re-render. Wrap in `useMemo` or split into multiple contexts.
- **State colocation**: keep state as local as possible. Lift only when siblings need it.

## Accessibility

- Semantic HTML (`button` not `div onClick`, `nav` for navigation).
- `aria-*` attributes only when no semantic equivalent.
- Form labels (`<label htmlFor>` or wrap input).
- Focus management on modal/dialog open.
- `alt` text on images (empty `alt=""` for decorative).

## JSX Pitfalls

- `className` not `class`.
- `htmlFor` not `for`.
- Self-close void elements (`<img />`, `<br />`, `<input />`).
- Inline event handlers are camelCase (`onClick`, `onChange`).
- `key` must be unique among siblings and stable across renders.
- Boolean attributes need explicit values (`disabled={true}`, not `disabled="true"`).

## Common Issues to Flag

- `useEffect` with no cleanup for subscriptions/timers → memory leak.
- `useState` storing derived/computed values → sync bug.
- Inline function passed to memoized child → child re-renders every render.
- Direct DOM mutation in React → fights React's reconciliation.
- Conditional hooks → Rules of Hooks violation, component breaks unpredictably.
- `setState` in render (without condition) → infinite re-render loop.
