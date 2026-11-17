"""Lockout for volunteer and NGO logins (persistent, see limit_store.py).

Three rules, all set in settings.py:

1. (account, client IP): after LOGIN_MAX_FAILURES wrong passwords within
   LOGIN_FAILURE_WINDOW_SECONDS, that pair is locked for
   LOGIN_LOCKOUT_SECONDS. A stranger guessing from their own network locks
   only themselves out; the owner can still log in from theirs.
2. Client IP across all accounts: at most LOGIN_IP_MAX_FAILURES failures per
   LOGIN_IP_WINDOW_SECONDS (stops one address from trying many accounts).
3. Account ceiling: LOGIN_ACCOUNT_MAX_FAILURES_PER_HOUR failures from any
   addresses lock the account for everyone until the oldest of them is an
   hour old. This is a last resort against a spread-out attack; a password
   reset clears it.

"Account" is (role, lowercased email) and unknown emails are counted exactly
like real ones, so neither the answer nor the lockout shows whether an
account exists. Every block gives the same 429 text the frontend already
shows ("Too many failed logins. Try again in N minutes."). The admin console
has its own separate lockout in admin_auth.py.
"""

import math

from fastapi import HTTPException

try:
    from . import rate_limit, settings
except ImportError:
    import rate_limit, settings


PAIR = "login-account-ip"
IP = "login-ip"
ACCOUNT = "login-account"


def _account(role: str, email: str) -> tuple[str, str]:
    return role, (email or "").strip().lower()


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


def blocked_for(role: str, email: str, ip: str) -> float:
    """Seconds until this login may be tried (0 = allowed now)."""
    store = rate_limit.get_store()
    account = _account(role, email)

    return max(
        store.locked_for(PAIR, (account, ip)),
        store.over_limit(IP, ip, settings.LOGIN_IP_MAX_FAILURES, settings.LOGIN_IP_WINDOW_SECONDS),
        store.over_limit(ACCOUNT, account, settings.LOGIN_ACCOUNT_MAX_FAILURES_PER_HOUR, 3600),
    )


def check_login_allowed(role: str, email: str, ip: str) -> None:
    """Raise 429 while any rule blocks this login. Call before the password check."""
    remaining = blocked_for(role, email, ip)
    if remaining > 0:
        _raise_locked(remaining)


def record_failed_login(role: str, email: str, ip: str) -> None:
    """Count one wrong password (or unknown email) against all three rules."""
    store = rate_limit.get_store()
    account = _account(role, email)

    failures = store.add(
        PAIR, (account, ip), settings.LOGIN_FAILURE_WINDOW_SECONDS, subject=account,
    )
    if failures >= settings.LOGIN_MAX_FAILURES:
        store.clear(PAIR, (account, ip))  # a finished lockout starts a fresh count
        store.lock(PAIR, (account, ip), settings.LOGIN_LOCKOUT_SECONDS, subject=account)

    store.add(IP, ip, settings.LOGIN_IP_WINDOW_SECONDS)
    store.add(ACCOUNT, account, 3600, subject=account)


def reset_failed_logins(role: str, email: str, ip: str) -> None:
    """After a correct password: forget this pair's failures.

    The per-IP and per-account counts stay, so a correct login does not hand
    an attacker on another network a fresh set of guesses.
    """
    rate_limit.get_store().clear(PAIR, (_account(role, email), ip))


def clear_account(role: str, email: str) -> None:
    """After a password reset: forget the account's failures and locks on every IP."""
    store = rate_limit.get_store()
    account = _account(role, email)
    store.clear_subject(PAIR, account)
    store.clear(ACCOUNT, account)
