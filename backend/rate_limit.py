"""Small in-memory sliding-window rate limits (generalises login_limiter.py).

State lives in this process only: a restart clears it and every worker has
its own counters, which is why DEPLOY.md asks for ONE worker.
"""

import math
import threading
import time
from collections import deque

from fastapi import HTTPException, Request

try:
    from .settings import TRUST_PROXY_HEADERS
except ImportError:
    from settings import TRUST_PROXY_HEADERS


class SlidingWindowLimiter:
    """Allow at most `limit` hits per key in any `window_seconds` window."""

    def __init__(self, limit: int, window_seconds: float, name: str = ""):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self._lock = threading.Lock()
        self._hits: dict = {}
        self._calls = 0

    def _trim(self, hits: deque, now: float) -> None:
        while hits and hits[0] <= now - self.window:
            hits.popleft()

    def _prune(self, now: float) -> None:
        for key in [k for k, h in self._hits.items() if not h or h[-1] <= now - self.window]:
            del self._hits[key]

    def hit(self, key) -> float:
        """Record a hit. Returns 0 when allowed, else seconds until one is free.

        A refused hit is not recorded, so a blocked client cannot extend its own block.
        """
        now = time.monotonic()

        with self._lock:
            self._calls += 1
            if self._calls % 256 == 0:
                self._prune(now)

            hits = self._hits.setdefault(key, deque())
            self._trim(hits, now)

            if len(hits) >= self.limit:
                return max(0.001, hits[0] + self.window - now)

            hits.append(now)
            return 0.0

    def check(self, key, detail: str) -> None:
        """hit(), raising 429 with Retry-After when the key is over its limit."""
        retry_after = self.hit(key)

        if retry_after:
            raise HTTPException(
                status_code=429,
                detail=detail,
                headers={"Retry-After": str(math.ceil(retry_after))},
            )

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


_registry: list[SlidingWindowLimiter] = []


def make_limiter(limit: int, window_seconds: float, name: str = "") -> SlidingWindowLimiter:
    limiter = SlidingWindowLimiter(limit, window_seconds, name)
    _registry.append(limiter)
    return limiter


def reset_all() -> None:
    """Forget every limiter's state (tests)."""
    for limiter in _registry:
        limiter.reset()


def client_ip(request: Request) -> str:
    """The caller's address; X-Forwarded-For is used only with TRUST_PROXY_HEADERS."""

    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first

    return request.client.host if request.client else "unknown"


def retry_text(seconds: float) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    return f"{minutes} minute{'s' if minutes != 1 else ''}"
