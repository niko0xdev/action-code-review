---
name: swift
description: Swift (v5.9+) and SwiftUI code review covering type safety, optionals, value vs reference semantics, concurrency (async/await + actors), and SwiftUI view lifecycle. Use when reviewing iOS/macOS code for memory leaks, retain cycles, force unwraps, and modern Swift concurrency.
---

# Swift Code Review

When reviewing Swift code, prioritize:

## Optionals

- **Avoid force unwraps (`!`)**: `foo!`, `try!`, `as!`. Replace with `guard let foo = foo else { return }` or `if let foo = foo`.
- **`guard let` for early exit**: when unwrap fail means "stop, no recovery possible". Reduces nesting.
- **`if let` for branching**: when unwrap fail has different behavior than success.
- **Optional chaining**: `user?.name?.first` — short-circuits on nil. Don't overuse for deep chains (silent failures).
- **Nil coalescing**: `name ?? "Unknown"` — fallback only on nil.
- **`?? fatalError`**: `user ?? fatalError("user required")` — only at known-good state (e.g., after auth).

## Memory & Reference Semantics

- **Value types (struct, enum)**: default. Copy semantics. No retain cycles to worry about.
- **Reference types (class)**: when identity matters. Watch for retain cycles.
- **Retain cycles with closures**: `[weak self]` for `self`-capturing closures stored on `self`:
  ```swift
  someHandler = { [weak self] in
    self?.doThing()
  }
  ```
- **`@MainActor` closures**: long-running work in `@MainActor` blocks main thread. Move off main for I/O.
- **Delegate weak references**: `weak var delegate: SomeDelegate?` — delegate protocols are class-bound, must be weak.

## Type System

- **`enum` for finite states**: not just for "this OR that" but for state machines with associated values:
  ```swift
  enum NetworkState {
    case idle
    case loading
    case success(Data)
    case failure(Error)
  }
  ```
- **Protocol composition**: `protocol P: A, B {}` for small, focused protocols (composition over inheritance).
- **`any` keyword** (5.7+): `let shape: any Drawable = Circle()` — disambiguates existential types.
- **Generics**: `func fetch<T: Decodable>(_ type: T.Type)`. Constrain with associated types: `protocol Repository { associatedtype Model }`.
- **Opaque types** (`some`): `func makeView() -> some View`. Hides concrete type, preserves type identity.

## Concurrency

- **`async`/`await`**: basic async work. `func fetch() async throws -> Data`.
- **`Task { }`**: fire-and-forget. Captures context (MainActor, etc.) if inside `Task.detached` for outside.
- **`@MainActor`**: UI work on main. View bodies are implicit `@MainActor`.
- **`async let`**: parallel awaits. `async let a = fetchA(); async let b = fetchB(); let result = try await (a, b)`.
- **`AsyncSequence`**: streams. `for await item in stream { }`.
- **Actors**: `actor Counter { var value: int = 0; func increment() { value += 1 } }`. Mutex under the hood. Prevents data races.
- **Sendable**: types safe to share across concurrency domains. Mark `struct` (value, automatic) or `@unchecked Sendable` (you guarantee safety).
- **Async/await vs GCD**: prefer async/await. Don't mix in new code. DispatchQueue.global().async {} is legacy.

## SwiftUI

- **View bodies are pure**: no side effects, no expensive computation. Use `let view = ...` outside body or in init.
- **`@State`**: source of truth owned by view. Mutations must come from view or via bindings.
- **`@Binding`**: two-way connection. `TextField(text: $name)` requires `@State var name`.
- **`@StateObject`**: owns an observable. Lazy once. `@ObservedObject` for injection.
- **`@EnvironmentObject`**: shared via `.environmentObject(...)`. Resolved by type. Useful for app-wide state.
- **`onAppear { }` vs `task { }`**: `task` for async work, `onAppear` for sync side effects. `task` automatically cancels when view disappears.
- **List identity**: `List(items, id: \.id)` — stable, unique IDs required. Index keys cause animation glitches.

## Error Handling

- **`throws` + `do/catch`**: for recoverable errors. `try`/`try?`/`try!`.
- **Custom error types**: `enum NetworkError: Error { case badStatus(Int); case decoding }` for typed errors.
- **`Result` type**: for callbacks `completion: (Result<Data, Error>) -> Void`. Less common with async/await.
- **Don't ignore errors**: `try?` swallows error silently. Use only when failure genuinely doesn't matter.

## Property Wrappers (iOS 14+ / SwiftUI)

- **`@AppStorage`**: UserDefaults-backed. Persists across launches.
- **`@SceneStorage`**: per-scene state, restored on relaunch.
- **`@FocusedValue` / `@FocusedBinding`**: focus-driven values, advanced.
- **`@FetchRequest`**: Core Data in SwiftUI. Sort and filter declaratively.

## Common Issues to Flag

- Force unwrap `!` on `URL(string:)` from user input → crash if invalid.
- Retain cycle from strong `self` capture in escaping closure → memory leak.
- `@StateObject` vs `@ObservedObject` confusion → view re-initialization bugs.
- Missing `[weak self]` in `NotificationCenter` observers → leak.
- `DispatchQueue.main.async { self.doThing() }` when `doThing` is `@MainActor` → warning in Swift 5.10+.
- Unbounded `URLSession.dataTask` (no resume? no completion?) → never completes.
- Cache pollution: `NSCache` with no cost limit + unbounded object keys → memory bloat.
- Hardcoded API URLs (use `URL(string:)` with constants from config).
