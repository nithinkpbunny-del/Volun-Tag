"""Rate limits for the password reset flow (see file 02 of the analysis).

* 3 reset requests per hour per (role, email) and 10 per hour per client IP;
  over the limit the request is dropped SILENTLY (same 200 answer), so the
  limit cannot be used to learn whether an account exists.
* 10 attempts to set a new password per 10 minutes per client IP (429).
"""

try:
    from .rate_limit import make_limiter
except ImportError:
    from rate_limit import make_limiter


REQUESTS_PER_ACCOUNT_PER_HOUR = 3
REQUESTS_PER_IP_PER_HOUR = 10
SUBMITS_PER_IP_PER_10_MIN = 10

_by_account = make_limiter(REQUESTS_PER_ACCOUNT_PER_HOUR, 3600, "reset-account")
_by_ip = make_limiter(REQUESTS_PER_IP_PER_HOUR, 3600, "reset-ip")
_submits = make_limiter(SUBMITS_PER_IP_PER_10_MIN, 600, "reset-submit")


def request_allowed(role: str, email: str, ip: str) -> bool:
    """Count one reset request; False means drop it silently."""
    if _by_ip.hit(ip):
        return False
    return not _by_account.hit((role, (email or "").strip().lower()))


def check_submit_allowed(ip: str) -> None:
    """Raise 429 when this IP has tried to set a password too often."""
    _submits.check(ip, "Too many attempts. Please wait a few minutes and try again.")
