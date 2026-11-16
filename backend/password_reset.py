"""Forgot / reset password for volunteers and NGOs (design: analysis file 02).

* POST /forgot-password       {role, email}          -> always the same 200
* POST /reset-password/verify {token}                -> {"valid": bool}
* POST /reset-password        {token, new_password}  -> 200, 400 or 422

Tokens are secrets.token_urlsafe(32); only their sha256 is stored. A link is
valid for PASSWORD_RESET_MINUTES (30), works once, and asking again cancels
older links. A successful reset ends every session of that account, clears
its login lockout, and sends a "password changed" notice. Tokens, links and
passwords are never logged.
"""

import logging
import secrets
from datetime import datetime, timedelta
from html import escape

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from . import login_limiter, mailer, rate_limit, reset_limiter, settings
    from .admin_auth import hash_token
    from .database import get_db
    from .db_models import NGODB, PasswordResetTokenDB, UserSessionDB, VolunteerDB
    from .password_hashing import hash_password
    from .password_policy import password_policy_error
    from .schemas import ForgotPasswordRequest, ResetPasswordRequest, ResetTokenRequest
except ImportError:
    import login_limiter, mailer, rate_limit, reset_limiter, settings
    from admin_auth import hash_token
    from database import get_db
    from db_models import NGODB, PasswordResetTokenDB, UserSessionDB, VolunteerDB
    from password_hashing import hash_password
    from password_policy import password_policy_error
    from schemas import ForgotPasswordRequest, ResetPasswordRequest, ResetTokenRequest


logger = logging.getLogger(__name__)

router = APIRouter(tags=["password reset"])

FORGOT_MESSAGE = "If an account exists for that email, a reset link has been sent."
INVALID_LINK = "This link is invalid or has expired."
DONE_MESSAGE = "Password updated. Please log in."

MODELS = {"volunteer": VolunteerDB, "ngo": NGODB}


def _find_account(db: Session, role: str, email: str):
    model = MODELS[role]
    if not email:
        return None
    return (
        db.query(model)
        .filter(model.email.isnot(None), func.lower(model.email) == email)
        .first()
    )


def _reset_mail(name: str, link: str, minutes: int) -> tuple[str, str]:
    text = (
        f"Hello {name},\n\n"
        "Someone (hopefully you) asked to reset the password of your VolunTag account.\n\n"
        f"Open this link to choose a new password:\n{link}\n\n"
        f"The link works once and is valid for {minutes} minutes.\n"
        "If you did not ask for this, ignore this email: your password stays the same.\n\n"
        "VolunTag"
    )
    html = (
        f"<p>Hello {escape(name)},</p>"
        "<p>Someone (hopefully you) asked to reset the password of your VolunTag account.</p>"
        f'<p><a href="{escape(link, quote=True)}">Choose a new password</a></p>'
        f"<p>The link works once and is valid for {minutes} minutes.<br>"
        "If you did not ask for this, ignore this email: your password stays the same.</p>"
        "<p>VolunTag</p>"
    )
    return text, html


def _changed_mail(name: str) -> str:
    return (
        f"Hello {name},\n\n"
        "The password of your VolunTag account was just changed, and every "
        "device that was logged in has been logged out.\n\n"
        "If this was not you, use \"Forgot password?\" on the login page right "
        "away, or reply to this email.\n\n"
        "VolunTag"
    )


def _live_token(db: Session, token: str):
    if not token or len(token) > 200:
        return None
    row = (
        db.query(PasswordResetTokenDB)
        .filter(PasswordResetTokenDB.token_hash == hash_token(token))
        .first()
    )
    if row is None or row.used_at is not None or row.expires_at <= datetime.utcnow():
        return None
    return row


@router.post("/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Send a reset link if the account exists. The answer never says whether it does."""

    email = (payload.email or "").strip().lower()
    ip = rate_limit.client_ip(request)

    if not reset_limiter.request_allowed(payload.role, email, ip):
        return {"message": FORGOT_MESSAGE}

    account = _find_account(db, payload.role, email)

    now = datetime.utcnow()
    db.query(PasswordResetTokenDB).filter(
        PasswordResetTokenDB.expires_at <= now,
    ).delete(synchronize_session=False)

    if account is None:
        db.commit()
        return {"message": FORGOT_MESSAGE}

    # Only the newest link works.
    db.query(PasswordResetTokenDB).filter(
        PasswordResetTokenDB.user_role == payload.role,
        PasswordResetTokenDB.user_id == account.id,
        PasswordResetTokenDB.used_at.is_(None),
    ).delete(synchronize_session=False)

    token = secrets.token_urlsafe(32)
    minutes = settings.PASSWORD_RESET_MINUTES

    db.add(PasswordResetTokenDB(
        token_hash=hash_token(token),
        user_role=payload.role,
        user_id=account.id,
        email=email,
        created_at=now,
        expires_at=now + timedelta(minutes=minutes),
    ))
    db.commit()

    logger.info("Password reset requested for %s id %s", payload.role, account.id)

    link = f"{settings.FRONTEND_BASE_URL}/reset-password?token={token}"
    text, html = _reset_mail(account.name, link, minutes)

    # Sent after the response, so timing does not depend on the mail server.
    background.add_task(
        mailer.send_mail,
        account.email, "Reset your VolunTag password", text, html,
        None, f"reset mail for {payload.role} id {account.id}",
    )

    return {"message": FORGOT_MESSAGE}


@router.post("/reset-password/verify")
def verify_reset_token(
    payload: ResetTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Lets the page say "link expired" before the user types a new password."""
    reset_limiter.check_submit_allowed(rate_limit.client_ip(request))
    return {"valid": _live_token(db, payload.token) is not None}


@router.post("/reset-password")
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    reset_limiter.check_submit_allowed(rate_limit.client_ip(request))

    row = _live_token(db, payload.token)

    if row is None:
        raise HTTPException(status_code=400, detail=INVALID_LINK)

    # A weak password does not use up the link.
    problem = password_policy_error(payload.new_password or "")
    if problem:
        raise HTTPException(status_code=422, detail=problem)

    model = MODELS.get(row.user_role)
    account = db.query(model).filter(model.id == row.user_id).first() if model else None

    if account is None:
        row.used_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=400, detail=INVALID_LINK)

    now = datetime.utcnow()
    account.password = hash_password(payload.new_password)
    row.used_at = now

    # End every session of this account and cancel its other links.
    db.query(UserSessionDB).filter(
        UserSessionDB.user_role == row.user_role,
        UserSessionDB.user_id == row.user_id,
    ).delete(synchronize_session=False)
    db.query(PasswordResetTokenDB).filter(
        PasswordResetTokenDB.user_role == row.user_role,
        PasswordResetTokenDB.user_id == row.user_id,
        PasswordResetTokenDB.id != row.id,
    ).delete(synchronize_session=False)

    db.commit()

    login_limiter.reset_failed_logins(row.user_role, account.email or row.email)
    logger.info("Password reset completed for %s id %s", row.user_role, row.user_id)

    background.add_task(
        mailer.send_mail,
        account.email, "Your VolunTag password was changed", _changed_mail(account.name),
        None, None, f"password-changed mail for {row.user_role} id {row.user_id}",
    )

    return {"message": DONE_MESSAGE}
