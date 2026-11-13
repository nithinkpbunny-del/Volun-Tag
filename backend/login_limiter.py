"""Rate limit for volunteer and NGO logins.

Failures are counted per (role, lowercased email). After MAX_FAILED_LOGINS
wrong tries that key is locked for LOCKOUT_SECONDS. Unknown emails are
counted the same way, so the response never reveals whether an account
exists. State lives in memory; a server restart clears it. The admin
console has its own separate lockout in admin_auth.py.
"""

import math
import threading
import time

from fastapi import HTTPException

MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 5 * 60
# A key with failures but no lockout is forgotten after this long idle.
STALE_SECONDS = 15 * 60

_lock = threading.Lock()
# key -> [failure_count, locked_until, last_failure_at]  (time.monotonic())
_state: dict[tuple[str, str], list] = {}


def _key(role: str, email: str) -> tuple[str, str]:
    return role, (email or "").strip().lower()


def _prune(now: float) -> None:
    stale = [
        k for k, (_, locked_until, last) in _state.items()
        if locked_until <= now and now - last > STALE_SECONDS
    ]

    for k in stale:
        del _state[k]


def _raise_locked(remaining: float) -> None:
    minutes = max(1, math.ceil(remaining / 60))

    raise HTTPException(
        status_code=429,
        detail=(
            f"Too many failed logins. "
            f"Try again in {minutes} minute{'s' if minutes != 1 else ''}."
        ),
        headers={"Retry-After": str(math.ceil(remaining))},
    )


def check_login_allowed(role: str, email: str) -> None:
    """Raise 429 while this (role, email) is locked. Call before the password check."""

    now = time.monotonic()

    with _lock:
        entry = _state.get(_key(role, email))
        remaining = (entry[1] - now) if entry else 0.0

    if remaining > 0:
        _raise_locked(remaining)


def record_failed_login(role: str, email: str) -> None:
    """Count one failed login; the 5th starts a lockout."""

    now = time.monotonic()

    with _lock:
        _prune(now)

        entry = _state.setdefault(_key(role, email), [0, 0.0, now])

        # A finished lockout starts a fresh count.
        if entry[1] and entry[1] <= now:
            entry[0] = 0
            entry[1] = 0.0

        entry[0] += 1
        entry[2] = now

        if entry[0] >= MAX_FAILED_LOGINS:
            entry[0] = 0
            entry[1] = now + LOCKOUT_SECONDS


def reset_failed_logins(role: str, email: str) -> None:
    """Forget the failures for this key after a correct login."""

    with _lock:
        _state.pop(_key(role, email), None)
