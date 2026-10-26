"""Admin console authentication: password check, sessions, lockout and audit log.

The admin password is never stored. backend/admin_secret.json (written by
create_admin_password.py, git-ignored) holds only a salted PBKDF2 hash.
Sessions are random bearer tokens; the database keeps only their sha256 hash.
"""

import hashlib
import json
import logging
import math
import secrets
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

try:
    from .database import get_db
    from .db_models import AdminActionDB, AdminSessionDB
except ImportError:
    from database import get_db
    from db_models import AdminActionDB, AdminSessionDB


logger = logging.getLogger(__name__)

SECRET_PATH = Path(__file__).resolve().with_name("admin_secret.json")

SESSION_LIFETIME = timedelta(hours=8)

MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 5 * 60

# Failed-login state lives in memory; a server restart clears it.
_lockout_lock = threading.Lock()
_failed_logins = 0
_locked_until = 0.0  # time.monotonic() value


# ─── Password ─────────────────────────────────────────────────────
def _load_secret() -> dict:
    """Read admin_secret.json, or raise 503 if it is missing or unreadable."""

    try:
        data = json.loads(SECRET_PATH.read_text(encoding="utf-8"))

        return {
            "salt": bytes.fromhex(data["salt"]),
            "iterations": int(data["iterations"]),
            "hash": bytes.fromhex(data["hash"]),
        }
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail="Admin access is not set up",
        )
    except (OSError, ValueError, KeyError, TypeError):
        logger.exception("Could not read %s", SECRET_PATH.name)
        raise HTTPException(
            status_code=503,
            detail="Admin access is not set up",
        )


def verify_password(plain: str) -> bool:
    """True when plain matches the stored hash. Raises 503 if not set up."""

    secret = _load_secret()

    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        plain.encode("utf-8"),
        secret["salt"],
        secret["iterations"],
    )

    return secrets.compare_digest(candidate, secret["hash"])


# ─── Login lockout ────────────────────────────────────────────────
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


def check_login_allowed() -> None:
    """Raise 429 while logins are locked after repeated failures."""

    with _lockout_lock:
        remaining = _locked_until - time.monotonic()

    if remaining > 0:
        _raise_locked(remaining)


def record_failed_login() -> bool:
    """Count one failed login. Returns True if this failure started a lockout."""

    global _failed_logins, _locked_until

    with _lockout_lock:
        _failed_logins += 1

        if _failed_logins < MAX_FAILED_LOGINS:
            return False

        _failed_logins = 0
        _locked_until = time.monotonic() + LOCKOUT_SECONDS

    return True


def raise_lockout_started() -> None:
    _raise_locked(LOCKOUT_SECONDS)


def reset_failed_logins() -> None:
    global _failed_logins

    with _lockout_lock:
        _failed_logins = 0


# ─── Sessions ─────────────────────────────────────────────────────
def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session) -> tuple[str, AdminSessionDB]:
    """Add a new session and return (token, session row).

    Only the token's hash is stored. The row is flushed, not committed, so
    the caller can commit it together with the login audit entry.
    """

    now = datetime.utcnow()

    # Drop expired sessions so the table does not grow forever.
    db.query(AdminSessionDB).filter(
        AdminSessionDB.expires_at <= now,
    ).delete(synchronize_session=False)

    token = secrets.token_urlsafe(32)

    session = AdminSessionDB(
        token_hash=hash_token(token),
        created_at=now,
        expires_at=now + SESSION_LIFETIME,
        last_used_at=now,
    )

    db.add(session)
    db.flush()

    return token, session


def _session_from_header(authorization: str, db: Session) -> Optional[AdminSessionDB]:
    """Return the live session for an "Authorization: Bearer <token>" header, or None."""

    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()

    if scheme.lower() != "bearer" or not token:
        return None

    session = db.query(AdminSessionDB).filter(
        AdminSessionDB.token_hash == hash_token(token),
    ).first()

    now = datetime.utcnow()

    if session is None or session.expires_at <= now:
        return None

    session.last_used_at = now
    db.commit()

    return session


def require_admin(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> AdminSessionDB:
    """Dependency: reject the request unless it carries a live admin session."""

    session = _session_from_header(authorization, db)

    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Admin session expired or invalid",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return session


def is_admin_request(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> bool:
    """Dependency: True when the request carries a live admin session; never raises."""

    return _session_from_header(authorization, db) is not None


# ─── Audit log ────────────────────────────────────────────────────
def log_admin_action(
    db: Session,
    action: str,
    target_type: Optional[str] = None,
    target_id=None,
    details: Optional[dict] = None,
) -> AdminActionDB:
    """Add an audit row to the session.

    It is not committed here: the caller's commit saves it together with the
    change it describes, so an action is never logged without happening.
    """

    entry = AdminActionDB(
        action=action,
        target_type=target_type,
        target_id=None if target_id is None else str(target_id),
        details=json.dumps(details or {}, default=str),
    )

    db.add(entry)

    return entry
