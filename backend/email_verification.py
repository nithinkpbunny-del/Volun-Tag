"""Email verification at signup, and the "already registered" notice.

* POST /verify-email          {token}        -> 200 or 400 {code, message}
* POST /resend-verification   {role, email}  -> always the same 200

New volunteer and NGO accounts start with email_verified = 0 and get a link
{FRONTEND_BASE_URL}/verify-email?token=<token>. The token is
secrets.token_urlsafe(32); only its sha256 is stored. A link is valid for
EMAIL_VERIFICATION_HOURS (24), works once, and asking for a new one makes
the older ones expire. Login refuses unverified accounts (403
email_not_verified, only after a correct password, see main.py).

Registration never says whether an email is taken (main.py): when it is,
the owner gets a short notice instead (or, if that account is still
unverified, a fresh link), limited to REGISTER_NOTICE_LIMIT_PER_DAY mails
per address. Tokens, links and passwords are never logged.
"""

import logging
import secrets
from datetime import datetime, timedelta
from html import escape

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from . import mailer, rate_limit, settings
    from .admin_auth import hash_token
    from .database import get_db
    from .db_models import EmailVerificationTokenDB, NGODB, VolunteerDB
    from .schemas import ResendVerificationRequest, VerifyEmailRequest
except ImportError:
    import mailer, rate_limit, settings
    from admin_auth import hash_token
    from database import get_db
    from db_models import EmailVerificationTokenDB, NGODB, VolunteerDB
    from schemas import ResendVerificationRequest, VerifyEmailRequest


logger = logging.getLogger(__name__)

router = APIRouter(tags=["email verification"])

MODELS = {"volunteer": VolunteerDB, "ngo": NGODB}

# Expired links are kept this long so the page can say "expired" rather than "invalid".
KEEP_EXPIRED = timedelta(days=7)

RESEND_MESSAGE = (
    "If an account with that email is waiting to be confirmed, "
    "we have sent it a new link."
)

LINK_ERRORS = {
    "verification_link_invalid": (
        "This confirmation link is not valid. Check that you opened the whole "
        "link from the email, or ask for a new one."
    ),
    "verification_link_expired": (
        "This confirmation link has expired (or a newer one was sent). "
        "Ask for a new link below."
    ),
    "verification_link_used": (
        "This link has already been used, so your email is confirmed. You can log in."
    ),
}

NOT_VERIFIED_CODE = "email_not_verified"
NOT_VERIFIED_MESSAGE = (
    "Please confirm your email address first. Open the link we emailed you, "
    "or send a new one."
)

_verify_limiter = rate_limit.make_limiter(
    settings.VERIFY_LIMIT_PER_IP_PER_10_MIN, 600, "verify-email-ip",
)
_resend_ip_limiter = rate_limit.make_limiter(
    settings.RESEND_LIMIT_PER_IP_PER_HOUR, 3600, "resend-verification-ip",
)
_resend_account_limiter = rate_limit.make_limiter(
    settings.RESEND_LIMIT_PER_ACCOUNT_PER_HOUR, 3600, "resend-verification-account",
)
_notice_limiter = rate_limit.make_limiter(
    settings.REGISTER_NOTICE_LIMIT_PER_DAY, 24 * 3600, "register-notice",
)


def error_body(code: str, message: str) -> dict:
    """{code, message, detail}: detail repeats message for older error helpers."""
    return {"code": code, "message": message, "detail": message}


def not_verified_response() -> JSONResponse:
    return JSONResponse(status_code=403, content=error_body(NOT_VERIFIED_CODE, NOT_VERIFIED_MESSAGE))


def is_verified(account) -> bool:
    return bool(getattr(account, "email_verified", 1))


def find_account(db: Session, role: str, email: str):
    model = MODELS[role]
    if not email:
        return None
    return (
        db.query(model)
        .filter(model.email.isnot(None), func.lower(model.email) == email)
        .first()
    )


# ─── Mail text ────────────────────────────────────────────────────
def _verify_mail(name: str, link: str, hours: int, again: bool) -> tuple[str, str]:
    intro = (
        "Someone (hopefully you) tried to sign up again with this address. Your "
        "account is not confirmed yet, so here is a new link."
        if again else
        "Thanks for signing up to VolunTag. Please confirm that this is your email address."
    )
    text = (
        f"Hello {name},\n\n{intro}\n\n"
        f"Open this link to confirm it:\n{link}\n\n"
        f"The link works once and is valid for {hours} hours.\n"
        "If you did not sign up, ignore this email and no account will be activated.\n\n"
        "VolunTag"
    )
    html = (
        f"<p>Hello {escape(name)},</p><p>{escape(intro)}</p>"
        f'<p><a href="{escape(link, quote=True)}">Confirm my email address</a></p>'
        f"<p>The link works once and is valid for {hours} hours.<br>"
        "If you did not sign up, ignore this email and no account will be activated.</p>"
        "<p>VolunTag</p>"
    )
    return text, html


def _notice_mail(name: str, role: str) -> tuple[str, str]:
    link = f"{settings.FRONTEND_BASE_URL}/forgot-password?role={role}"
    text = (
        f"Hello {name},\n\n"
        "Someone just tried to register a new VolunTag account with this email "
        "address. You already have an account, so nothing was changed.\n\n"
        "If it was you and you cannot remember your password, reset it here:\n"
        f"{link}\n\n"
        "If it was not you, you can ignore this email.\n\n"
        "VolunTag"
    )
    html = (
        f"<p>Hello {escape(name)},</p>"
        "<p>Someone just tried to register a new VolunTag account with this email "
        "address. You already have an account, so nothing was changed.</p>"
        f'<p>If it was you and you cannot remember your password, '
        f'<a href="{escape(link, quote=True)}">reset it here</a>.</p>'
        "<p>If it was not you, you can ignore this email.</p><p>VolunTag</p>"
    )
    return text, html


# ─── Tokens ───────────────────────────────────────────────────────
def issue_token(db: Session, role: str, account) -> str:
    """Create a new link for the account and make its older unused links expire.

    The caller commits.
    """
    now = datetime.utcnow()

    db.query(EmailVerificationTokenDB).filter(
        EmailVerificationTokenDB.expires_at <= now - KEEP_EXPIRED,
    ).delete(synchronize_session=False)

    db.query(EmailVerificationTokenDB).filter(
        EmailVerificationTokenDB.user_role == role,
        EmailVerificationTokenDB.user_id == account.id,
        EmailVerificationTokenDB.used_at.is_(None),
        EmailVerificationTokenDB.expires_at > now,
    ).update({EmailVerificationTokenDB.expires_at: now}, synchronize_session=False)

    token = secrets.token_urlsafe(32)
    db.add(EmailVerificationTokenDB(
        token_hash=hash_token(token),
        user_role=role,
        user_id=account.id,
        email=(account.email or "").strip().lower(),
        created_at=now,
        expires_at=now + timedelta(hours=settings.EMAIL_VERIFICATION_HOURS),
    ))
    return token


def queue_verification_mail(background: BackgroundTasks, role: str, account, token: str, again=False) -> None:
    link = f"{settings.FRONTEND_BASE_URL}/verify-email?token={token}"
    text, html = _verify_mail(account.name, link, settings.EMAIL_VERIFICATION_HOURS, again)
    background.add_task(
        mailer.send_mail,
        account.email, "Confirm your VolunTag email address", text, html,
        None, f"verification mail for {role} id {account.id}",
    )


def start_verification(db: Session, background: BackgroundTasks, role: str, account) -> None:
    """For a NEW account (already flushed, so it has an id): token, commit, mail."""
    token = issue_token(db, role, account)
    db.commit()
    queue_verification_mail(background, role, account, token)


def handle_existing_email(db: Session, background: BackgroundTasks, role: str, account) -> None:
    """Registration with an address that already has an account.

    Verified account: a short "you already have an account" notice. Not yet
    verified: a fresh confirmation link. At most REGISTER_NOTICE_LIMIT_PER_DAY
    mails per address; over that, nothing is sent (silently).
    """
    email = (account.email or "").strip().lower()

    if _notice_limiter.hit((role, email)):
        logger.info("Registration notice for %s id %s skipped (limit)", role, account.id)
        return

    if is_verified(account):
        text, html = _notice_mail(account.name, role)
        background.add_task(
            mailer.send_mail,
            account.email, "Someone tried to register with your email address", text, html,
            None, f"existing-account notice for {role} id {account.id}",
        )
        return

    token = issue_token(db, role, account)
    db.commit()
    queue_verification_mail(background, role, account, token, again=True)


# ─── Endpoints ────────────────────────────────────────────────────
@router.post("/verify-email")
def verify_email(
    payload: VerifyEmailRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Confirm the address behind a link. 400 {code} says why a link does not work."""

    _verify_limiter.check(
        rate_limit.client_ip(request),
        "Too many attempts. Please wait a few minutes and try again.",
    )

    token = payload.token or ""
    row = None
    if 0 < len(token) <= 200:
        row = (
            db.query(EmailVerificationTokenDB)
            .filter(EmailVerificationTokenDB.token_hash == hash_token(token))
            .first()
        )

    def fail(code):
        return JSONResponse(status_code=400, content=error_body(code, LINK_ERRORS[code]))

    if row is None:
        return fail("verification_link_invalid")
    if row.used_at is not None:
        return fail("verification_link_used")
    now = datetime.utcnow()
    if row.expires_at <= now:
        return fail("verification_link_expired")

    model = MODELS.get(row.user_role)
    account = db.query(model).filter(model.id == row.user_id).first() if model else None

    if account is None:
        row.used_at = now
        db.commit()
        return fail("verification_link_invalid")

    account.email_verified = 1

    # This link and every other open link of the account are now used up,
    # so an older email says "already confirmed" instead of failing.
    db.query(EmailVerificationTokenDB).filter(
        EmailVerificationTokenDB.user_role == row.user_role,
        EmailVerificationTokenDB.user_id == row.user_id,
        EmailVerificationTokenDB.used_at.is_(None),
    ).update({EmailVerificationTokenDB.used_at: now}, synchronize_session=False)

    db.commit()
    logger.info("Email verified for %s id %s", row.user_role, row.user_id)

    return {
        "status": "verified",
        "role": row.user_role,
        "message": "Your email address is confirmed. You can log in now.",
    }


@router.post("/resend-verification")
def resend_verification(
    payload: ResendVerificationRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Send a new link if the account exists and is unverified. The answer never says which."""

    _resend_ip_limiter.check(
        rate_limit.client_ip(request),
        "You have asked for several links. Please try again in an hour.",
    )

    email = (payload.email or "").strip().lower()

    # Over the per-account limit the request is dropped silently (same answer).
    if not email or _resend_account_limiter.hit((payload.role, email)):
        return {"message": RESEND_MESSAGE}

    account = find_account(db, payload.role, email)

    if account is not None and not is_verified(account):
        token = issue_token(db, payload.role, account)
        db.commit()
        queue_verification_mail(background, payload.role, account, token)
        logger.info("Verification link re-sent for %s id %s", payload.role, account.id)

    return {"message": RESEND_MESSAGE}

