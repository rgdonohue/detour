"""Coalesce identical concurrent calls.

Two simultaneous requests with the same cache key should produce one upstream
call, not two. Both callers await the same `asyncio.Task` and see the same
result — or the same exception, which is re-raised at the call site so the
existing FastAPI error mapping stays put.

Caller passes a zero-arg factory rather than a coroutine, so the inner coroutine
is only created when we actually intend to run it (avoids "coroutine was never
awaited" warnings on the dedup path).
"""
import asyncio
from typing import Any, Awaitable, Callable


async def dedupe_inflight(
    store: dict[str, asyncio.Task[Any]],
    key: str,
    factory: Callable[[], Awaitable[Any]],
) -> Any:
    """Run `factory()` if no task is already running for `key`. Otherwise
    await the existing task. Removes the entry on completion (success or
    failure). Re-raises any exception from the inner coroutine."""
    existing = store.get(key)
    if existing is not None:
        return await existing
    task: asyncio.Task[Any] = asyncio.create_task(factory())
    store[key] = task
    try:
        return await task
    finally:
        store.pop(key, None)
