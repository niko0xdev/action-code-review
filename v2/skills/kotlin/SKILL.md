---
name: kotlin
description: Kotlin (v1.9+) and Jetpack Compose code review covering null safety, coroutines, Compose state, sealed classes, and Android-specific patterns. Use when reviewing Kotlin code (Android, KMP, server-side) for safe APIs, coroutine scopes, and idiomatic Kotlin patterns.
---

# Kotlin Code Review

When reviewing Kotlin code, prioritize:

## Null Safety

- **Nullable vs non-null types**: `String` (non-null) vs `String?` (nullable). Kotlin enforces at compile time.
- **`?.let { }` for null-safe blocks**: `user?.let { println(it.name) }` — only enters block when non-null.
- **`?:` Elvis operator**: `name ?: "Unknown"` — fallback when null.
- **`!!` (force unwrap)**: `name!!` — crashes on null. Avoid, use `requireNotNull(name) { "name required" }` for tests.
- **`requireNotNull` / `checkNotNull`**: throws `IllegalArgumentException` or `IllegalStateException` with a message. Better than `!!`.
- **Smart casts after null check**: `if (x != null) x.method()` — Kotlin auto-narrows type. No cast needed.

## Coroutines

- **`CoroutineScope`**: owns coroutines. Tied to lifecycle. `lifecycleScope` in Android UI.
- **`launch`**: fire coroutine that doesn't return value. `async` returns `Deferred` for await-able result.
- **`awaitAll` / `await`**: parallel = `awaitAll(deferred1, deferred2)`. Sequential is fine when dependencies exist.
- **Structured concurrency**: `coroutineScope { }` cancels children on exception. Prevents leaks.
- **Dispatchers**: `Dispatchers.Main` (UI), `Dispatchers.IO` (I/O), `Dispatchers.Default` (CPU). Pick by workload type.
- **`withContext(Dispatchers.IO)`**: switch dispatcher in suspend function.
- **`Flow`**: cold stream. `collect` to consume. Hot variants: `StateFlow`, `SharedFlow`.
- **`viewModelScope`**: ViewModel-bound scope. Auto-cancelled on ViewModel cleared.
- **Don't use `GlobalScope`**: leaks. Always use scoped (viewModelScope, lifecycleScope, custom scope).

## Data Classes

- **`data class`**: auto-generates equals/hashCode/copy/toString. Default for DTOs and value objects.
- **`copy()` for modification**: `val updated = user.copy(age = 30)`. Immutable by default.
- **Destructuring**: `val (name, age) = user` — based on declared order. Only `component1..N` for data classes.
- **`Pair` / `Triple`**: convenient but lack semantics. Prefer named data class for clarity.

## Sealed Classes (ADT)

- **`sealed class`/`sealed interface`**: restricted hierarchy. Compiler knows all subtypes → exhaustive `when`.
- **Exhaustive `when`**: no `else` needed when all sealed subtypes covered:
  ```kotlin
  when (result) {
    is Loading -> showProgress()
    is Success -> showData(result.data)
    is Error -> showError(result.message)
    // no else — compiler verifies exhaustive
  }
  ```
- **`sealed interface`**: for non-hierarchical types or multiple inheritance.

## Object & Companion

- **`object`**: singleton. Lazy init. Use for stateless utility (`object FileUtils`) or true singletons.
- **`companion object`**: like Java's static. `MyClass.create()` not `MyClass.Companion.create()`.
- **`@JvmStatic`**: from companion to expose as Java static for consumers.

## Jetpack Compose

- **Composables are functions**: `@Composable fun Greeting(name: String)` — same name, no side effects in body.
- **Recomposition**: when state changes, only composables reading that state recompose. Don't read non-Compose state.
- **`remember`**: state across recomposition. `remember { mutableStateOf(0) }`.
- **`rememberSaveable`**: state preserved across config changes (rotation). Bundle-backed.
- **`derivedStateOf`**: compute cached state. `val canSubmit by remember { derivedStateOf { name.isNotBlank() } }`.
- **Side effects**: `LaunchedEffect(key) { /* run on mount, cancel on unmount */ }`. `DisposableEffect` for cleanup.
- **`collectAsStateWithLifecycle`**: collect Flow with lifecycle awareness. For Android UI.
- **List keys**: `LazyColumn { items(list, key = { it.id }) { item -> Row(item) } }` for stable identity.

## Android Specific

- **ViewModel for state**: keep state in ViewModel, not in composables. Survives config changes.
- **Repository pattern**: ViewModel → Repository → (Network, DB). DataSource interface for testability.
- **Hilt / Koin / Manual DI**: pick one. Hilt is Google-recommended for Android.
- **`@HiltViewModel`**: for ViewModel injection. Use `@Inject lateinit var repo: UserRepo`.
- **`Flow` from DB**: `userRepo.observeAll(): Flow<List<User>>` — auto-update via Room.
- **Configuration changes**: any state lives in ViewModel, not Composables.

## Extensions & Scope

- **Extension functions**: `fun String.titleCase(): String = this.split(' ').map { it.capitalize() }.joinToString(" ")`.
- **Scope functions**: `let`, `run`, `with`, `apply`, `also`. Use sparingly — easy to abuse.
- **`apply`**: configure-and-return-self. `val p = Paint().apply { color = RED; strokeWidth = 2f }`.
- **`also`**: side effect, return self. `val list = mutableList.add(item).also { log("Added $item") }`.

## Common Issues to Flag

- `!!` non-null assertion (almost always wrong).
- `GlobalScope.launch` (leaks; use scoped).
- Smart cast not happening because of mutable property — capture in local val.
- `runBlocking` in coroutine context (blocks event loop).
- `Array<T>` instead of `List<T>` (arrays are mutable, fixed-size; lists are modern).
- Java-style getters (`getName()` vs Kotlin property `name`).
- Missing `data class` for value objects.
- Comparison with `==` on arrays (reference equality, not content; use `contentEquals`).
- Lateinit misuse: `lateinit` on non-nullable, non-primitive. Throws on access before init.
- Calling `runBlocking` in Android app (blocks UI thread).
