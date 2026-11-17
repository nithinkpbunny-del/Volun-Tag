"""Backend settings, read once from plain environment variables.

Every default reproduces the local setup, so nothing has to be set to run the
app on a laptop. backend/.env.example documents each variable.

DATA_DIR holds everything the app writes and must keep between restarts:
voluntag.db, uploads/ (with messages/ and resolutions/) and admin_secret.json.
"""

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent

DEFAULT_ALLOWED_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


def _env_text(name: str) -> str:
    """Return the variable without surrounding spaces ("" when unset)."""
    return os.environ.get(name, "").strip()


def _env_bool(name: str, default: bool) -> bool:
    """Read true/false (also 1/0, yes/no, on/off); blank or unset gives default."""
    raw = _env_text(name).lower()

    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False

    raise ValueError(f"{name} must be true or false, not {os.environ[name]!r}")


def _env_list(name: str, default) -> list[str]:
    """Read a comma-separated list; blank or unset gives default."""
    raw = _env_text(name)

    if not raw:
        return list(default)

    # Browsers send Origin without a trailing slash, so drop one if given.
    items = [item.strip().rstrip("/") for item in raw.split(",")]
    items = [item for item in items if item]

    if not items:
        raise ValueError(f"{name} is set but lists no values: {os.environ[name]!r}")

    return items


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    """Read a whole number; blank or unset gives default."""
    raw = _env_text(name)

    if not raw:
        return default

    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a whole number, not {os.environ[name]!r}")

    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, not {value}")

    return value


def _env_float(name: str, default: float) -> float:
    """Read a decimal number; blank or unset gives default."""
    raw = _env_text(name)

    if not raw:
        return default

    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number, not {os.environ[name]!r}")


def _env_choice(name: str, default: str, choices: tuple) -> str:
    raw = _env_text(name).lower() or default

    if raw not in choices:
        raise ValueError(f"{name} must be one of {', '.join(choices)}, not {raw!r}")

    return raw


_data_dir = _env_text("DATA_DIR")
DATA_DIR = Path(_data_dir).expanduser().resolve() if _data_dir else BACKEND_DIR

DATABASE_PATH = DATA_DIR / "voluntag.db"
UPLOAD_DIR = DATA_DIR / "uploads"
MESSAGES_UPLOAD_DIR = UPLOAD_DIR / "messages"
RESOLUTIONS_UPLOAD_DIR = UPLOAD_DIR / "resolutions"
ADMIN_SECRET_PATH = DATA_DIR / "admin_secret.json"

ALLOWED_ORIGINS = _env_list("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
SEED_DEMO_DATA = _env_bool("SEED_DEMO_DATA", True)

# ─── Environment and API docs ─────────────────────────────────────
# "production" switches the interactive API docs off unless ENABLE_DOCS says otherwise.
APP_ENV = _env_choice("APP_ENV", "development", ("development", "production"))
ENABLE_DOCS = _env_bool("ENABLE_DOCS", APP_ENV != "production")

# Read the client address from X-Forwarded-For. Only turn this on behind a
# proxy you control that sets the header; otherwise clients can fake it.
TRUST_PROXY_HEADERS = _env_bool("TRUST_PROXY_HEADERS", False)
# How many proxies you control sit in front of the app (load balancer, nginx,
# ...). The client address is the entry this many places from the RIGHT of
# X-Forwarded-For, because entries further left are whatever the client sent.
# 0 with TRUST_PROXY_HEADERS=true is treated as 1 (a warning is logged).
TRUSTED_PROXY_COUNT = _env_int("TRUSTED_PROXY_COUNT", 0, 0)

# ─── Upload limits ────────────────────────────────────────────────
MAX_REQUEST_BYTES = _env_int("MAX_REQUEST_BYTES", 40 * 1024 * 1024, 1024)
MAX_IMAGE_BYTES = _env_int("MAX_IMAGE_BYTES", 10 * 1024 * 1024, 1024)
MAX_DOCUMENT_BYTES = _env_int("MAX_DOCUMENT_BYTES", 5 * 1024 * 1024, 1024)
MAX_IMAGE_PIXELS = _env_int("MAX_IMAGE_PIXELS", 25_000_000, 10_000)
# Photos are shrunk to fit this many pixels per side before BLIP and CLIP.
AI_IMAGE_MAX_SIDE = _env_int("AI_IMAGE_MAX_SIDE", 1024, 64)

# ─── Rate limits ──────────────────────────────────────────────────
# Every limiter (logins, registrations, verification, password reset,
# contact form, reports) keeps its counters in one small SQLite file, so a
# restart does not clear them and several processes share them.
RATE_LIMIT_DB_PATH = (
    Path(_env_text("RATE_LIMIT_DB_PATH")).expanduser().resolve()
    if _env_text("RATE_LIMIT_DB_PATH") else DATA_DIR / "ratelimits.db"
)
REPORT_LIMIT_PER_HOUR = _env_int("REPORT_LIMIT_PER_HOUR", 5, 1)
VOLUNTEER_SIGNUP_LIMIT_PER_HOUR = _env_int("VOLUNTEER_SIGNUP_LIMIT_PER_HOUR", 10, 1)
NGO_SIGNUP_LIMIT_PER_HOUR = _env_int("NGO_SIGNUP_LIMIT_PER_HOUR", 5, 1)
CONTACT_LIMIT_PER_HOUR_PER_IP = _env_int("CONTACT_LIMIT_PER_HOUR_PER_IP", 3, 1)
CONTACT_LIMIT_PER_DAY_PER_EMAIL = _env_int("CONTACT_LIMIT_PER_DAY_PER_EMAIL", 3, 1)

# Login lockout. Wrong passwords are counted per (account, client IP): after
# LOGIN_MAX_FAILURES within LOGIN_FAILURE_WINDOW_SECONDS that pair is locked
# for LOGIN_LOCKOUT_SECONDS, so a stranger on another network cannot lock
# the real owner out. One IP may fail LOGIN_IP_MAX_FAILURES times (across all
# accounts) per LOGIN_IP_WINDOW_SECONDS. As a last resort an account that
# collects LOGIN_ACCOUNT_MAX_FAILURES_PER_HOUR failures from anywhere is
# locked for everyone until the hour has passed (a password reset clears it).
LOGIN_MAX_FAILURES = _env_int("LOGIN_MAX_FAILURES", 5, 1)
LOGIN_FAILURE_WINDOW_SECONDS = _env_int("LOGIN_FAILURE_WINDOW_SECONDS", 15 * 60, 1)
LOGIN_LOCKOUT_SECONDS = _env_int("LOGIN_LOCKOUT_SECONDS", 5 * 60, 1)
LOGIN_IP_MAX_FAILURES = _env_int("LOGIN_IP_MAX_FAILURES", 30, 1)
LOGIN_IP_WINDOW_SECONDS = _env_int("LOGIN_IP_WINDOW_SECONDS", 15 * 60, 1)
LOGIN_ACCOUNT_MAX_FAILURES_PER_HOUR = _env_int("LOGIN_ACCOUNT_MAX_FAILURES_PER_HOUR", 50, 1)

# ─── Email verification at signup ────────────────────────────────
# true: new volunteer and NGO accounts must open the link mailed to them
# before they can log in, and registration answers the same way whether or
# not the email is already registered. false (demos without mail): new
# accounts are created verified and a taken email gets the old
# "already registered" error (this reveals which emails exist).
EMAIL_VERIFICATION_REQUIRED = _env_bool("EMAIL_VERIFICATION_REQUIRED", True)
EMAIL_VERIFICATION_HOURS = _env_int("EMAIL_VERIFICATION_HOURS", 24, 1)
VERIFY_LIMIT_PER_IP_PER_10_MIN = _env_int("VERIFY_LIMIT_PER_IP_PER_10_MIN", 20, 1)
RESEND_LIMIT_PER_ACCOUNT_PER_HOUR = _env_int("RESEND_LIMIT_PER_ACCOUNT_PER_HOUR", 3, 1)
RESEND_LIMIT_PER_IP_PER_HOUR = _env_int("RESEND_LIMIT_PER_IP_PER_HOUR", 10, 1)
# "Someone tried to register with your address" notices, per address.
REGISTER_NOTICE_LIMIT_PER_DAY = _env_int("REGISTER_NOTICE_LIMIT_PER_DAY", 3, 1)

# ─── Mail ─────────────────────────────────────────────────────────
MAIL_ENABLED = _env_bool("MAIL_ENABLED", True)
SMTP_HOST = _env_text("SMTP_HOST") or "127.0.0.1"
SMTP_PORT = _env_int("SMTP_PORT", 1025, 1)
SMTP_USERNAME = _env_text("SMTP_USERNAME")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_STARTTLS = _env_bool("SMTP_STARTTLS", False)
SMTP_SSL = _env_bool("SMTP_SSL", False)
SMTP_TIMEOUT_SECONDS = _env_int("SMTP_TIMEOUT_SECONDS", 10, 1)
MAIL_FROM = _env_text("MAIL_FROM") or "VolunTag <no-reply@voluntag.local>"
FRONTEND_BASE_URL = (_env_text("FRONTEND_BASE_URL") or "http://localhost:3000").rstrip("/")
PASSWORD_RESET_MINUTES = _env_int("PASSWORD_RESET_MINUTES", 30, 1)
CONTACT_INBOX = _env_text("CONTACT_INBOX") or "contact@voluntag.example"
# Contact-form messages are always stored and read in the admin console
# ("Contact messages"). Set this to true to ALSO mail each one to CONTACT_INBOX.
CONTACT_SEND_EMAIL = _env_bool("CONTACT_SEND_EMAIL", False)
# Secret mixed into the hash of contact-form IP addresses. Blank = a random
# value per server start (hashes then cannot be compared across restarts).
IP_HASH_SALT = _env_text("IP_HASH_SALT")

# ─── Report a problem: photo / description check ─────────────────
# enforce = reject a report whose photos do not match its description,
# log = accept it but log the score, off = do not compute the check.
REPORT_MISMATCH_MODE = _env_choice("REPORT_MISMATCH_MODE", "log", ("enforce", "log", "off"))
# CLIP cosine similarity between a photo and "a photo of {description}".
# A report is a mismatch when EVERY photo scores below this value.
# Calibration on the existing reports (tools/report_calibration, DEPLOY.md)
# could NOT separate matching from mismatching pairs (AUC 0.56), so the mode
# defaults to "log" and 0.14 is the value that rejected no genuine photo.
REPORT_MISMATCH_CLIP_MIN = _env_float("REPORT_MISMATCH_CLIP_MIN", 0.14)

# ─── Matching ─────────────────────────────────────────────────────
MATCH_USE_RATINGS = _env_bool("MATCH_USE_RATINGS", True)
MATCH_RATING_MIN_COUNT = _env_int("MATCH_RATING_MIN_COUNT", 3, 1)
# The bonus can never exceed 5 % of the score, whatever is configured.
MATCH_RATING_MAX_BONUS = min(max(_env_float("MATCH_RATING_MAX_BONUS", 0.05), 0.0), 0.05)
MATCH_V2 = _env_bool("MATCH_V2", False)
MATCH_PUBLIC_ROW_LIMIT = _env_int("MATCH_PUBLIC_ROW_LIMIT", 24, 1)

for _folder in (DATA_DIR, UPLOAD_DIR, MESSAGES_UPLOAD_DIR, RESOLUTIONS_UPLOAD_DIR):
    _folder.mkdir(parents=True, exist_ok=True)
