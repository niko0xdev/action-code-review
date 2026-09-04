---
name: typescript
description: TypeScript (v5+) code review covering type system correctness, strict mode usage, generic constraints, and avoiding `any`/`as` escape hatches. Use when reviewing TypeScript code for type safety, narrowing, and proper use of advanced type features.
---

# TypeScript Code Review

When reviewing TypeScript code, prioritize:

## Strict Mode

- **`strict: true`**: enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictBindCallApply`, `alwaysStrict`. Non-negotiable for new code.
- **`noUncheckedIndexedAccess`**: `arr[i]` returns `T | undefined`, forcing null check. Catches off-by-one bugs.
- **`exactOptionalPropertyTypes`**: `{ x?: number }` is `number | undefined` only if explicitly set. Distinguishes "not set" from "explicitly undefined".
- **`noImplicitOverride`**: subclasses must mark overridden methods with `override` keyword.

## Avoid `any` and Unsafe Casts

- **`any`**: disables type checking. Use `unknown` for values of uncertain type and narrow with type guards.
- **`as` casts**: bypasses type system. Prefer type guards (`if (typeof x === 'string')`) or branded types.
- **`as unknown as T`**: double cast to force compatibility. Almost always a code smell — the types genuinely don't match.
- **`@ts-ignore` / `@ts-expect-error`**: escape hatches. Add a comment explaining WHY. Never use to silence legitimate errors.

## Generics

- **Constraints**: `function fn<T extends keyof X>(key: T)` ensures `key` is a valid key of `X`. Without constraint, `T` could be anything.
- **Multiple type parameters**: usually a sign the function does too much. Consider splitting.
- **`infer` in conditional types**: `ReturnType<typeof fn>` infers return type. Powerful but complex — document carefully.
- **Default type parameters**: `T = SomeDefault` for backward-compatible generic APIs.

## Type Narrowing

- **Discriminated unions**: `{ kind: 'circle'; radius: number } | { kind: 'square'; side: number }` — TS narrows on `kind` discriminant.
- **`switch` exhaustiveness**: `const _: never = shape;` after switch ensures all cases handled. Add to add new variants = compile error.
- **Type predicates**: `function isString(x: unknown): x is string { return typeof x === 'string'; }` — custom guards for narrowing.
- **Assertion functions**: `function assertDefined<T>(x: T | undefined): asserts x is T` — throws if false, narrows after.

## Null Safety

- **`!` non-null assertion**: bypasses null check. Use sparingly — better to handle the null case explicitly. OK for "I just checked this" cases with comments.
- **Optional chaining**: `obj?.prop?.method()` — returns undefined if any link is null. Safe but can mask bugs (silent failures).
- **Nullish coalescing**: `x ?? defaultValue` — falls back only on null/undefined, NOT on `0`, `''`, `false`. Use this over `||` when 0/empty is valid.

## Interfaces vs Types

- **`interface`**: for object shapes that may be extended. Supports declaration merging.
- **`type`**: for unions, intersections, mapped types, conditional types. More flexible.
- **Pick/Omit/Partial/Required**: utility types for transforming existing types.
- **`Record<K, V>`**: typed object with keys `K` and values `V`. `Record<string, Foo>` is shorthand for `{ [key: string]: Foo }`.

## Performance (Type-only)

- **Type-only imports**: `import type { Foo } from 'bar';` ensures `Foo` is erased at compile time. Saves bundle size for types.
- **`isolatedModules`**: ensures each file can be transpiled independently. Required for `tsc --isolatedModules` and tools like esbuild/swc.
- **Avoid type computation in hot paths**: types are erased but complex conditional types slow tsc. Cache computed types as named aliases.

## Common Issues to Flag

- `any` (especially in function signatures, not just variables).
- `as` casts without justification.
- Missing return type on exported functions (forces callers to type-narrow).
- Non-null assertion `!` without preceding null check.
- `// eslint-disable-next-line` without comment explaining why.
- Type assertion in test files (`expect(x as Foo)`) — usually indicates test type doesn't match source.
- `Object`/`Function` types (use specific types).
- Implicit `any` from untyped dependencies (`@types/...` missing).

## Migration Tips (JS → TS)

- Start with `allowJs: true` and `checkJs: false` to type-check incrementally.
- Use `// @ts-expect-error` while fixing errors one file at a time.
- Add types to dependencies first (`@types/node`, `@types/express`).
- Use `unknown` instead of `any` during migration; narrow with guards.
