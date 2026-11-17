"""Sliding-window rate limits and the one client_ip() helper every limiter uses.

Counters live in the persistent SQLite store (limit_store.py), so they
survive a restart and are shared by every worker process.
"""

import ipaddress
import logging
import math
from typing import Optional

from fastapi import HTTPException, Request

try:
    from . import settings
    from .limit_store import LimitStore
except ImportError:
    import settings
    from limit_store import LimitStore


logger = logging.getLogger(__name__)

_store: Optional[LimitStore] = None


def get_store() -> LimitStore:
    """The shared store (created on first use at settings.RATE_LIMIT_DB_PATH)."""
    global _store
    if _store is None:
        _store = LimitStore(settings.RATE_LIMIT_DB_PATH)
    return _store


def set_store(store: Optional[LimitStore]) -> None:
    """Use another store (tests); None goes back to the default file."""
    global _store
    _store = store


class SlidingWindowLimiter:
    """Allow at most `limit` hits per key in any `window_seconds` window."""

    def __init__(self, limit: int, window_seconds: float, name: str):
        if not name:
            raise ValueError("every limiter needs a unique name (its bucket in the store)")
        self.limit = limit
        self.window = window_seconds
        self.name = name

    def hit(self, key) -> float:
        """Record a hit. Returns 0 when allowed, else seconds until one is free.

        A refused hit is not recorded, so a blocked client cannot extend its own block.
        """
        return get_store().hit(self.name, key, self.limit, self.window)

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
        get_store().clear_bucket(self.name)


_registry: dict[str, SlidingWindowLimiter] = {}


def make_limiter(limit: int, window_seconds: float, name: str) -> SlidingWindowLimiter:
    if name in _registry:
        raise ValueError(f"a limiter named {name!r} already exists")
    limiter = SlidingWindowLimiter(limit, window_seconds, name)
    _registry[name] = limiter
    return limiter


def reset_all() -> None:
    """Forget every limiter's state, login lockouts included (tests)."""
    get_store().clear_all()


# ─── Client address ───────────────────────────────────────────────
def _parse_ip(value: str) -> Optional[str]:
    """A normalised IP address from one X-Forwarded-For entry, or None.

    Accepts "1.2.3.4", "1.2.3.4:5678", "2001:db8::1" and "[2001:db8::1]:443".
    """
    value = (value or "").strip().strip('"')
    if not value:
        return None

    candidates = [value]
    if value.startswith("[") and "]" in value:
        candidates.append(value[1:value.index("]")])
    elif value.count(":") == 1:
        candidates.append(value.split(":", 1)[0])

    for candidate in candidates:
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            continue
    return None


_warned_zero_count = False


def trusted_proxy_count() -> int:
    """How many proxies to step over; 0 while proxy headers are not trusted."""
    global _warned_zero_count

    if not settings.TRUST_PROXY_HEADERS:
        return 0

    count = settings.TRUSTED_PROXY_COUNT
    if count < 1:
        if not _warned_zero_count:
            logger.warning(
                "TRUST_PROXY_HEADERS is on but TRUSTED_PROXY_COUNT is 0; using 1. "
                "Set TRUSTED_PROXY_COUNT to the number of proxies in front of the app."
            )
            _warned_zero_count = True
        count = 1
    return count


def _forwarded_entries(request: Request, header: str) -> list[str]:
    """Every comma-separated entry of a header, in order, across repeated headers."""
    return [
        part.strip()
        for value in request.headers.getlist(header)
        for part in value.split(",")
        if part.strip()
    ]


def client_ip(request: Request) -> str:
    """The caller's address, for rate limits and logs.

    Without TRUST_PROXY_HEADERS this is the address of whatever opened the
    connection; X-Forwarded-For is ignored, so a client cannot choose its
    own address. With it, each of the TRUSTED_PROXY_COUNT proxies appended
    the address it received the request from, so the client is the entry
    TRUSTED_PROXY_COUNT places from the right. Entries further left were
    written by the client and are never used. If the header is shorter than
    expected or the entry is not an IP address, the connection address is used.
    """
    peer = request.client.host if request.client else "unknown"

    count = trusted_proxy_count()
    if not count:
        return peer

    entries = _forwarded_entries(request, "x-forwarded-for")
    if len(entries) < count:
        return peer

    return _parse_ip(entries[-count]) or peer


def request_is_https(request: Request) -> bool:
    """True when the browser reached us over https (directly or via a trusted proxy)."""
    if request.url.scheme == "https":
        return True

    if trusted_proxy_count():
        entries = _forwarded_entries(request, "x-forwarded-proto")
        # The nearest proxy (which we trust) writes or appends the last entry.
        return bool(entries) and entries[-1].lower() == "https"

    return False


def retry_text(seconds: float) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    return f"{minutes} minute{'s' if minutes != 1 else ''}"
