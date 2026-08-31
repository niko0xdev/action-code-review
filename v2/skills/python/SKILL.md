---
name: python
description: Python (3.11+) code review covering PEP 8 style, type hints, async patterns, packaging with pyproject.toml/uv, and Pythonic idioms. Use when reviewing Python code (FastAPI, Django, Flask, scripts, ML code) for correctness, idioms, and modern best practices.
---

# Python Code Review

When reviewing Python code, prioritize:

## Style (PEP 8)

- **Line length**: 88-100 chars (Black/Ruff default). Wrap long lines.
- **Naming**: `snake_case` functions/variables, `PascalCase` classes, `UPPER_SNAKE` constants, `_leading_underscore` private.
- **Imports**: stdlib → third-party → local. One import per line for `from x import y, z` is OK; alphabetical sort.
- **Docstrings**: PEP 257 format. First line imperative (`"""Fetch user by ID."""`). Use Google or NumPy style consistently.
- **Type hints**: PEP 484. Use `from __future__ import annotations` for forward references.

## Type Hints

- **`typing` module**: `list[int]` (not `List[int]`) in 3.9+. Use `|` for unions: `int | str` (3.10+) not `Union[int, str]`.
- **`Optional[X]` → `X | None`**: 3.10+ syntax. Backward compat: stick to `Optional` for public APIs.
- **Generic**: `def first(items: list[T]) -> T | None`. Constrain with `T: Comparable` if needed.
- **TypedDict**: `class User(TypedDict): id: int; name: str` for dict-shaped data.
- **`Self` type**: 3.11+ `def with_name(self, name: str) -> Self` for fluent methods.

## Async

- **`async def` + `await`**: I/O-bound operations. CPU-bound work → `multiprocessing` or `ProcessPoolExecutor`.
- **Don't mix sync/await**: blocking calls in async functions freeze event loop. Use `asyncio.to_thread(blocking_fn)` for unavoidable sync I/O.
- **`asyncio.gather`**: parallel awaits. Sequential `await` when not needed = N× latency.
- **`TaskGroup`**: 3.11+ structured concurrency. Replaces `gather` for most cases. Auto-cancels on exception.
- **No `asyncio.run` inside `asyncio.run`**: "asyncio.run() cannot be called from a running event loop". Use main entry point only.

## Imports

- **No `from x import *`**: pollutes namespace. Use explicit imports.
- **Circular imports**: refactor with TYPE_CHECKING:
  ```python
  from typing import TYPE_CHECKING
  if TYPE_CHECKING:
      from .models import User
  ```
- **Relative vs absolute**: prefer absolute imports for clarity. Relative only within package.

## Async/Sync Mistakes

- **Forgotten await**: `result = some_async_fn()` returns coroutine, not value. Add `await`. Tests catch this with `RuntimeWarning: coroutine was never awaited`.
- **Sync I/O in async**: `requests.get()` in async def freezes loop. Use `httpx.AsyncClient()` or `aiohttp`.
- **Missing `await` on async context managers**: `async with db.session():` not `with db.session():` (latter is sync).

## Packaging

- **`pyproject.toml` (PEP 621)**: package metadata, dependencies (`[project] dependencies`), tool config (Ruff, pytest, mypy sections).
- **uv for fast installs**: `uv pip install -r requirements.txt` or `uv sync` (with `uv.lock`).
- **Lock files**: uv.lock, poetry.lock, pdm.lock — commit these for reproducible builds.
- **Editable installs**: `uv pip install -e .` for development. Don't ship editable installs.
- **Entry points**: `[project.scripts]` in pyproject.toml for CLI commands.

## Testing

- **`pytest`**: de facto standard. Test files: `test_*.py` or `*_test.py`. Functions: `def test_X():`.
- **Fixtures**: `@pytest.fixture` for setup. Use `conftest.py` for shared fixtures across files.
- **Parametrize**: `@pytest.mark.parametrize("input,expected", [...])` for table-driven tests.
- **`assert` is fine**: pytest assertions are runtime-checked. Don't use `unittest.TestCase.assertEqual`.
- **Async tests**: `pytest-asyncio` plugin. `@pytest.mark.asyncio` decorator or `asyncio_mode=auto`.

## Pythonic Idioms

- **List/dict/set comprehensions**: prefer over `map`/`filter` when readable. `[x*2 for x in nums if x > 0]`.
- **`enumerate` over `(i, x)` tuple unpacking**: `for i, val in enumerate(items):`.
- **`zip` for parallel iteration**: `for a, b in zip(list_a, list_b):`.
- **`with` statement**: for all resource management (files, locks, connections). No `try/finally` boilerplate.
- **`isinstance` over `type(x) == Foo`**: respects subclasses.
- **`dataclasses`** (3.7+): `@dataclass class Point: x: int; y: int` instead of `__init__` boilerplate.
- **Match statement** (3.10+): `match shape: case Circle(r=r): ...`. Like switch but with destructuring.

## Common Issues to Flag

- Mutable default arguments: `def f(x=[]):` — shared across calls. Use `def f(x=None): x = x or []`.
- Bare `except:` — catches everything including KeyboardInterrupt. Use `except Exception:` or specific.
- `print()` left in production code.
- `os.path.join` with absolute path argument → ignores earlier args: `os.path.join('/base', '/abs')` = `/abs`.
- String formatting with `+` instead of f-strings.
- Shadowing builtins (`list`, `dict`, `type`, `id`).
- `global` / `nonlocal` without good reason.
- `== None` instead of `is None`.
- Try/except that's too broad or swallows errors silently.
