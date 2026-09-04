---
name: javascript
description: Modern JavaScript (ES2022+) code review covering ES module syntax, async/await, destructuring, spread operators, and DOM/browser-specific pitfalls. Use when reviewing plain JavaScript files (.js, .mjs) without TypeScript.
---

# JavaScript Code Review

When reviewing plain JavaScript code, prioritize:

## ES Modules

- **Named vs default exports**: prefer named exports (`export function foo()`). Default exports are harder to rename/refactor.
- **Import order**: external deps first, then internal modules, then relative (./foo). ESLint `import/order` enforces.
- **No CommonJS in modules**: don't mix `require()` and `import`. For hybrid projects, use ESM only.
- **Dynamic imports**: `await import('./module')` for code splitting. Returns a module record with all exports.

## Modern Syntax

- **Optional chaining**: `obj?.prop?.method?.()` — concise null safety. Avoid for deep chains where you might want to handle each null level differently.
- **Nullish coalescing**: `val ?? default` — when 0/empty/false is valid input. Use instead of `||` for "missing value" checks.
- **Destructuring**: `const { a, b } = obj` — clean extraction. Use `const { a = 'default' } = obj` for default values.
- **Spread for immutability**: `{ ...obj, key: val }` creates new object. Don't spread + mutate (`{ ...arr }.push(x)` doesn't work).
- **Template literals**: prefer over string concatenation, especially with multi-line strings. Use `${expr}` for interpolation.

## Async/Await

- **await Promise.all()**: parallel async operations. Sequential `await` calls add latency unnecessarily.
- **No async in forEach**: `arr.forEach(async () => ...)` doesn't wait. Use `for...of` or `Promise.all(arr.map(async ...))`.
- **Top-level await in ESM**: works in modules and `package.json` `"type": "module"`. Avoid in CommonJS.
- **AbortController**: for cancellable requests `fetch(url, { signal: ac.signal })`. Prevents wasted work on discarded requests.

## Equality

- **`===` and `!==`**: always. Never `==` (unless intentionally leveraging coercion, e.g. `x == null` checks both null and undefined).
- **No `=== undefined`**: use `typeof x === 'undefined'` for undeclared variables. `=== undefined` throws ReferenceError.
- **`Object.is`**: when you need exact equality (NaN equals NaN, +0/-0 distinguished). Mostly for internal use.

## Numbers

- **`Number.parseInt` / `Number.parseFloat`**: explicit radix `parseInt(str, 10)` always.
- **`Number.isNaN`**: check `x !== x` (NaN) or `Number.isNaN(x)`. Don't use global `isNaN` (coerces).
- **BigInt**: for integers larger than `Number.MAX_SAFE_INTEGER` (2^53 - 1). Don't mix with regular numbers.

## Strings

- **Unicode-safe operations**: `str.length` counts UTF-16 code units, not characters. Use `Array.from(str)` for true character iteration.
- **`String.prototype.normalize`**: for comparing strings with different Unicode forms (NFC vs NFD).
- **No regex DoS**: catastrophic backtracking patterns like `(a+)+b` on long input. Use atomic groups or rewrite.

## Arrays

- **Immutability**: `[...arr]` (copy), `arr.filter()`, `arr.map()` — never `arr.push()` if arr should be immutable.
- **`at()` method**: `arr.at(-1)` for last element (ES2022). Better than `arr[arr.length - 1]`.
- **`flat()` / `flatMap()`**: for nested arrays. `flatMap` combines map + flat(1).
- **`find` vs `filter`**: `find` returns first match (or undefined), `filter` returns array. Use `find` when you only need one.
- **Avoid `splice`**: mutates in place. Prefer `toSpliced()` (ES2023) for immutable splice.

## Classes

- **Private fields**: `#field` syntax for true privacy (ES2022). Not just `_field` convention.
- **Static blocks**: `static { /* init */ }` for one-time class initialization (ES2022).
- **Getters/setters sparingly**: can surprise consumers with hidden computation. Prefer explicit methods.

## Common Issues to Flag

- Missing `'use strict'` (ESM has it implicit, but watch for CommonJS).
- `var` instead of `const`/`let`.
- `==` instead of `===`.
- `console.log` left in production code.
- Missing error handling on async operations.
- Modifying objects/arrays passed as props.
- JSON.parse without try/catch.
- Infinite loops or unbounded recursion.
- Memory leaks from event listeners not removed.
- `setTimeout` with string argument (eval-like, never use).
- `with` statement (forbidden in strict mode).
