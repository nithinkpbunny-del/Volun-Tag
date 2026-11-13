"""Volunteer and NGO login sessions.

Sessions are random bearer tokens (secrets.token_urlsafe(32)); the database
keeps only their sha256 hash, in user_sessions. They work like the admin
sessions in admin_auth.py, which this module reuses for Bearer parsing and
token hashing but never changes.
"""

import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

try:
    from .admin_auth import _session_from_header as _admin_session_from_header
    from .admin_auth import hash_token
    from .database import get_db
    from .db_models import UserSessionDB
except ImportError:
    from admin_auth import _session_from_header as _admin_session_from_header
    from admin_auth import hash_token
    from database import get_db
    from db_models import UserSessionDB


SESSION_LIFETIME = timedelta(hours=12)

LOGIN_AGAIN_DETAIL = "Please log in again"
NOT_YOURS_DETAIL = "You can only access your own data"


# ─── Sessions ─────────────────────────────────────────────────────
def create_user_session(
    db: Session,
    role: str,
    user_id: int,
    email: str,
) -> tuple[str, UserSessionDB]:
    """Add a session for a volunteer or NGO and return (token, row).

    Expired sessions are deleted first. Only the token's hash is stored.
    The caller commits.
    """

    now = datetime.utcnow()

    db.query(UserSessionDB).filter(
        UserSessionDB.expires_at <= now,
    ).delete(synchronize_session=False)

    token = secrets.token_urlsafe(32)

    session = UserSessionDB(
        token_hash=hash_token(token),
        user_role=role,
        user_id=user_id,
        email=(email or "").strip().lower(),
        created_at=now,
        expires_at=now + SESSION_LIFETIME,
        last_used_at=now,
    )

    db.add(session)
    db.flush()

    return token, session


def _bearer_token(authorization: str) -> Optional[str]:
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()

    if scheme.lower() != "bearer" or not token:
        return None

    return token


def _live_session(authorization: str, db: Session) -> Optional[UserSessionDB]:
    """Return the live user session for an Authorization header, or None."""

    token = _bearer_token(authorization)

    if token is None:
        return None

    session = db.query(UserSessionDB).filter(
        UserSessionDB.token_hash == hash_token(token),
    ).first()

    now = datetime.utcnow()

    if session is None or session.expires_at <= now:
        return None

    session.last_used_at = now
    db.commit()

    return session


def delete_session_for_header(authorization: str, db: Session) -> None:
    """Delete the session behind a Bearer header, if there is one."""

    token = _bearer_token(authorization)

    if token is None:
        return

    db.query(UserSessionDB).filter(
        UserSessionDB.token_hash == hash_token(token),
    ).delete(synchronize_session=False)
    db.commit()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=LOGIN_AGAIN_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )


# ─── Dependencies ─────────────────────────────────────────────────
def require_user(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> UserSessionDB:
    """Any live volunteer or NGO session, else 401."""

    session = _live_session(authorization, db)

    if session is None:
        raise _unauthorized()

    return session


def _require_role(session: UserSessionDB, role: str) -> UserSessionDB:
    if session.user_role != role:
        raise HTTPException(status_code=403, detail=NOT_YOURS_DETAIL)

    return session


def require_volunteer(
    session: UserSessionDB = Depends(require_user),
) -> UserSessionDB:
    """A live volunteer session: 401 if none, 403 for an NGO session."""

    return _require_role(session, "volunteer")


def require_ngo(
    session: UserSessionDB = Depends(require_user),
) -> UserSessionDB:
    """A live NGO session: 401 if none, 403 for a volunteer session."""

    return _require_role(session, "ngo")


def require_user_or_admin(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Optional[UserSessionDB]:
    """For file routes: returns the user session, or None for an admin session.

    Raises 401 when the token is neither a live user nor a live admin session.
    """

    session = _live_session(authorization, db)

    if session is not None:
        return session

    if _admin_session_from_header(authorization, db) is not None:
        return None

    raise _unauthorized()


# ─── Ownership ────────────────────────────────────────────────────
def same_email(a: Optional[str], b: Optional[str]) -> bool:
    """Case-insensitive, whitespace-trimmed email comparison."""

    return bool(a and b and a.strip().lower() == b.strip().lower())


def ensure_own_email(session: UserSessionDB, email: Optional[str]) -> None:
    """Raise 403 unless email is the session's own."""

    if not same_email(session.email, email):
        raise HTTPException(status_code=403, detail=NOT_YOURS_DETAIL)
