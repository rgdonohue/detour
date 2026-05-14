"""In-process sliding-window rate limiter.

Single Railway API instance means we don't need distributed coordination —
counts live in this process. Each endpoint owns a RateLimiter that may carry
both global and per-IP windows; a request is allowed only when every window
has capacity. Blocked requests get the longest retry-after across all
windows that exceeded their limit.

Limits are tuned to sit BELOW OpenRouteService's free-tier quotas so the
shared upstream key never sees the burst.
"""
import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Iterable


@dataclass
class _Window:
    """One sliding-window counter. Events are timestamps in monotonic seconds."""
    limit: int
    window_seconds: float
    events: deque[float] = field(default_factory=deque)


class RateLimiter:
    """Per-endpoint limiter with optional global and per-IP windows.

    Pass each scope as an iterable of (limit, window_seconds) tuples. Example:

        RateLimiter("route",
            global_limits=[(35, 60), (1800, 86400)],
            ip_limits=[(20, 60), (300, 86400)],
        )

    means 35/min and 1800/day across all callers PLUS 20/min and 300/day per IP.
    All buckets must allow the request for it to pass.
    """

    def __init__(
        self,
        name: str,
        *,
        global_limits: Iterable[tuple[int, float]] = (),
        ip_limits: Iterable[tuple[int, float]] = (),
    ) -> None:
        self.name = name
        self._global = [_Window(limit, window) for limit, window in global_limits]
        self._ip_spec: tuple[tuple[int, float], ...] = tuple(ip_limits)
        self._ip_state: dict[str, list[_Window]] = defaultdict(self._new_ip_windows)
        self._lock = asyncio.Lock()

    def _new_ip_windows(self) -> list[_Window]:
        return [_Window(limit, window) for limit, window in self._ip_spec]

    async def check(self, ip: str) -> float:
        """Atomically check every window for this caller. Returns 0 if allowed
        (and consumes a slot from each window), else the seconds to wait."""
        async with self._lock:
            return self._consume(self._global + self._ip_state[ip])

    async def check_ip(self, ip: str) -> float:
        """Only the per-IP windows. Use this at handler entry for abuse limits
        that should fire on every request (including cache hits)."""
        async with self._lock:
            return self._consume(self._ip_state[ip])

    async def check_global(self) -> float:
        """Only the global windows. Use this immediately before an ORS-backed
        call so cache hits don't consume upstream-protection quota."""
        async with self._lock:
            return self._consume(self._global)

    def _consume(self, windows: list[_Window]) -> float:
        now = time.monotonic()
        # Sweep expired events out of every window first so the limit check
        # sees only currently-counted requests.
        for w in windows:
            cutoff = now - w.window_seconds
            while w.events and w.events[0] < cutoff:
                w.events.popleft()
        # If any window is at limit, return the longest retry-after.
        retry = 0.0
        for w in windows:
            if len(w.events) >= w.limit:
                retry = max(retry, w.window_seconds - (now - w.events[0]))
        if retry > 0:
            # Tell the caller at least 1s — fractional retry hints are not actionable.
            return max(retry, 1.0)
        for w in windows:
            w.events.append(now)
        return 0.0

    def reset(self) -> None:
        """Clear all state. Tests only."""
        for w in self._global:
            w.events.clear()
        self._ip_state.clear()
