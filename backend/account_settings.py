"""Settings for logged-in volunteers and NGOs.

Every endpoint works on the account behind the bearer token, so nobody can
reach another account's settings: there is no email or id in the path.

Profile
* GET   /volunteer/me     PATCH /volunteer/me   (volunteer session only)
* GET   /ngo/me           PATCH /ngo/me         (NGO session only)
  The PATCH bodies are allow-lists (schemas.VolunteerProfileUpdate,
  schemas.NGOProfileUpdate, extra="forbid"): email, password, name of an NGO,
  documents, approval status, ratings and ids cannot be sent (422). Only the
  fields present in the body change. A skills change re-encodes the
  volunteer's matching vector at once; a mission (motto) change re-encodes
  the NGO's. Approval status never changes here.

Security
* POST /account/password                 {current_password, new_password}
* GET  /account/sessions
* POST /account/sessions/logout-others

Email
* POST /account/email          {password, new_email}  -> always the same 200
* POST /confirm-email-change   {token}  (public: the link may open anywhere)
  The link goes to the NEW address and works once, for EMAIL_CHANGE_HOURS.
  The address changes only when it is opened; then the old address gets a
  notice and every other session ends. A taken address gets the same answer
  and no link, so the endpoint never says which addresses have accounts.

Your data / account
* POST /account/export         {password}           -> JSON download
* POST /account/deactivate     {password, confirm}  -> soft deactivation
  Deactivation only sets deactivated_at: nothing is deleted. Login is refused
  (403 account_inactive, only after a correct password), every session ends,
  and the account drops out of matching, event lists, the NGO list and the
  public counts. An admin can reactivate it (admin.py).

Tokens and passwords are never logged.
"""

import logging
import secrets
from datetime import datetime, timedelta
from html import escape

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

try:
    from . import event_rules, mailer, rate_limit, settings
    from .admin_auth import hash_token
    from .database import get_db
    from .db_models import (
        ActivityDB, ActivitySignupDB, EmailChangeTokenDB, EmailVerificationTokenDB, IssueDB,
        IssueResolutionDB, MessageDB, NGODB, PasswordResetTokenDB, UserSessionDB, VolunteerDB,
    )
    from .embedding_store import get_vectors
    from .password_hashing import DUMMY_HASH, hash_password, is_hashed, verify_password
    from .password_policy import password_policy_error
    from .schemas import (
        ChangeEmailRequest, ChangePasswordRequest, DeactivateRequest, EmailChangeTokenRequest,
        NGODocumentOnFile, NGOProfileResponse, NGOProfileUpdate, PasswordConfirmRequest,
        SessionEntry, VolunteerProfileResponse, VolunteerProfileUpdate,
    )
    from .user_auth import _bearer_token, require_ngo, require_user, require_volunteer
except ImportError:
    import event_rules, mailer, rate_limit, settings
    from admin_auth import hash_token
    from database import get_db
    from db_models import (
        ActivityDB, ActivitySignupDB, EmailChangeTokenDB, EmailVerificationTokenDB, IssueDB,
        IssueResolutionDB, MessageDB, NGODB, PasswordResetTokenDB, UserSessionDB, VolunteerDB,
    )
    from embedding_store import get_vectors
    from password_hashing import DUMMY_HASH, hash_password, is_hashed, verify_password
    from password_policy import password_policy_error
    from schemas import (
        ChangeEmailRequest, ChangePasswordRequest, DeactivateRequest, EmailChangeTokenRequest,
        NGODocumentOnFile, NGOProfileResponse, NGOProfileUpdate, PasswordConfirmRequest,
        SessionEntry, VolunteerProfileResponse, VolunteerProfileUpdate,
    )
    from user_auth import _bearer_token, require_ngo, require_user, require_volunteer


logger = logging.getLogger(__name__)

router = APIRouter(tags=["account settings"])

MODELS = {"volunteer": VolunteerDB, "ngo": NGODB}

WRONG_PASSWORD = "The password you entered is not correct."
SAME_PASSWORD = "The new password must be different from your current password."

# NGO documents shown read-only in Settings: (column, label).
NGO_DOCUMENTS = (
    ("registration_certificate", "Registration certificate"),
    ("pan_card", "PAN card"),
    ("cert_12a", "12A certificate"),
    ("cert_80g", "80G certificate"),
    ("cert_fcra", "FCRA certificate"),
    ("trust_deed", "Trust deed"),
    ("society_registration_certificate", "Society registration certificate"),
    ("society_moa", "Society MOA"),
    ("section8_incorporation_certificate", "Section 8 incorporation certificate"),
    ("section8_moa_aoa", "Section 8 MOA/AOA"),
)

INACTIVE_CODE = "account_inactive"
INACTIVE_MESSAGE = (
    "This account cannot be used to log in. If you think this is a mistake, "
    "contact us through the Contact page."
)

_password_account_limiter = rate_limit.make_limiter(
    settings.CHANGE_PASSWORD_LIMIT_PER_HOUR, 3600, "change-password-account",
)
_account_ip_limiter = rate_limit.make_limiter(
    settings.ACCOUNT_ACTION_LIMIT_PER_IP_PER_HOUR, 3600, "account-action-ip",
)
_email_change_limiter = rate_limit.make_limiter(
    settings.EMAIL_CHANGE_LIMIT_PER_HOUR, 3600, "email-change-account",
)
_email_confirm_ip_limiter = rate_limit.make_limiter(
    settings.VERIFY_LIMIT_PER_IP_PER_10_MIN, 600, "email-change-confirm-ip",
)
_export_limiter = rate_limit.make_limiter(
    settings.DATA_EXPORT_LIMIT_PER_HOUR, 3600, "data-export-account",
)
_deactivate_limiter = rate_limit.make_limiter(
    settings.DEACTIVATE_LIMIT_PER_HOUR, 3600, "deactivate-account",
)


# ─── Deactivation state (used by login and the lists) ─────────────
def is_deactivated(account) -> bool:
    return getattr(account, "deactivated_at", None) is not None


def inactive_login_response() -> JSONResponse:
    """403 for a deactivated account, sent only after a correct password."""
    return JSONResponse(
        status_code=403,
        content={"code": INACTIVE_CODE, "message": INACTIVE_MESSAGE, "detail": INACTIVE_MESSAGE},
    )


# ─── Helpers ──────────────────────────────────────────────────────
def _fmt_utc(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def load_account(db: Session, session: UserSessionDB):
    """The volunteer or NGO row behind a session (401 if it is gone or deactivated)."""
    model = MODELS.get(session.user_role)
    account = db.query(model).filter(model.id == session.user_id).first() if model else None
    if account is None or is_deactivated(account):
        raise HTTPException(
            status_code=401, detail="Please log in again",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return account


def check_rate(session: UserSessionDB, request: Request, account_limiter, detail: str) -> None:
    """Count one attempt against the account and the client IP (429 when over)."""
    _account_ip_limiter.check(rate_limit.client_ip(request), detail)
    account_limiter.check((session.user_role, session.user_id), detail)


def password_matches(account, password: str) -> bool:
    """verify_password, at the same cost for accounts without a usable hash."""
    stored = getattr(account, "password", None)
    if not password or not is_hashed(stored):
        verify_password(password or "", DUMMY_HASH)
        return False
    return verify_password(password, stored)


def require_password(account, password: str) -> None:
    """400 with one generic message when the password is wrong."""
    if not password_matches(account, password):
        raise HTTPException(status_code=400, detail=WRONG_PASSWORD)


def revoke_other_sessions(db: Session, session: UserSessionDB) -> int:
    """Delete every session of this account except the current one. Caller commits."""
    return db.query(UserSessionDB).filter(
        UserSessionDB.user_role == session.user_role,
        UserSessionDB.user_id == session.user_id,
        UserSessionDB.id != session.id,
    ).delete(synchronize_session=False)


def _split_list(text) -> list[str]:
    return [item.strip() for item in (text or "").split(",") if item.strip()]


def volunteer_profile(volunteer: VolunteerDB) -> VolunteerProfileResponse:
    return VolunteerProfileResponse(
        name=volunteer.name,
        email=volunteer.email,
        contact_number=volunteer.contact_number,
        age=volunteer.age,
        designation=volunteer.designation,
        gender=volunteer.gender,
        skills=volunteer.skills,
        location=volunteer.location,
        availability=volunteer.availability,
        experience=volunteer.experience,
        bio=volunteer.bio,
        cause_interests=_split_list(volunteer.cause_interests),
    )


def ngo_profile(ngo: NGODB) -> NGOProfileResponse:
    return NGOProfileResponse(
        name=ngo.name,
        email=ngo.email,
        contact_number=ngo.contact_number,
        category=ngo.category,
        location=ngo.location,
        address=ngo.address,
        website_url=ngo.website_url,
        motto=ngo.motto,
        legal_structure=ngo.legal_structure,
        year_founded=ngo.year_founded,
        verification_status=ngo.verification_status,
        documents=[
            NGODocumentOnFile(kind=column, label=label)
            for column, label in NGO_DOCUMENTS
            if getattr(ngo, column, None)
        ],
    )


def _refresh_vectors(db: Session, items: list, what: str) -> None:
    """Re-encode matching vectors now (MiniLM runs under its usual MODEL_LOCK).

    If encoding fails, the stored vector keeps its old text hash, so the next
    matching request sees it is stale and encodes it then. Nothing is lost.
    """
    try:
        get_vectors(db, items)
    except Exception:
        db.rollback()
        logger.exception("Could not refresh the %s vector now; it is refreshed on next use", what)


# ─── Volunteer profile ────────────────────────────────────────────
@router.get("/volunteer/me", response_model=VolunteerProfileResponse)
def get_my_volunteer_profile(
    session: UserSessionDB = Depends(require_volunteer),
    db: Session = Depends(get_db),
):
    return volunteer_profile(load_account(db, session))


@router.patch("/volunteer/me", response_model=VolunteerProfileResponse)
def update_my_volunteer_profile(
    payload: VolunteerProfileUpdate,
    session: UserSessionDB = Depends(require_volunteer),
    db: Session = Depends(get_db),
):
    volunteer = load_account(db, session)
    changes = {name: getattr(payload, name) for name in payload.model_fields_set}

    if "cause_interests" in changes:
        changes["cause_interests"] = ", ".join(changes["cause_interests"] or []) or None
    for optional in ("experience", "bio"):
        if optional in changes:
            changes[optional] = changes[optional] or None

    new_name = changes.get("name")
    if new_name and new_name.lower() != (volunteer.name or "").lower():
        taken = db.query(VolunteerDB.id).filter(
            func.lower(VolunteerDB.name) == new_name.lower(),
            VolunteerDB.id != volunteer.id,
        ).first()
        if taken:
            raise HTTPException(status_code=400, detail=f"Volunteer '{new_name}' already exists")

    skills_changed = "skills" in changes and changes["skills"] != volunteer.skills

    for name, value in changes.items():
        setattr(volunteer, name, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="That name is already taken")

    if skills_changed and volunteer.skills:
        _refresh_vectors(db, [("volunteer_skills", volunteer.id, volunteer.skills)], "volunteer skills")

    logger.info("Volunteer id %s updated profile fields: %s", volunteer.id, sorted(changes))
    db.refresh(volunteer)
    return volunteer_profile(volunteer)


# ─── NGO profile ──────────────────────────────────────────────────
@router.get("/ngo/me", response_model=NGOProfileResponse)
def get_my_ngo_profile(
    session: UserSessionDB = Depends(require_ngo),
    db: Session = Depends(get_db),
):
    return ngo_profile(load_account(db, session))


@router.patch("/ngo/me", response_model=NGOProfileResponse)
def update_my_ngo_profile(
    payload: NGOProfileUpdate,
    session: UserSessionDB = Depends(require_ngo),
    db: Session = Depends(get_db),
):
    """Edit the NGO's own details. Name, documents and approval status stay as approved."""

    ngo = load_account(db, session)
    changes = {name: getattr(payload, name) for name in payload.model_fields_set}
    if "address" in changes:
        changes["address"] = changes["address"] or None

    motto_changed = "motto" in changes and changes["motto"] != ngo.motto

    for name, value in changes.items():
        setattr(ngo, name, value)
    db.commit()

    # The category is read at scoring time (category boost, keyword rule), so
    # a new category takes effect on the next matching request by itself.
    # The mission text has stored vectors: re-encode them now.
    if motto_changed and ngo.motto:
        _refresh_vectors(
            db,
            [("ngo_motto", ngo.id, ngo.motto.strip()), ("ngo_motto_raw", ngo.id, ngo.motto)],
            "NGO mission",
        )

    logger.info("NGO id %s updated profile fields: %s", ngo.id, sorted(changes))
    db.refresh(ngo)
    return ngo_profile(ngo)


# ─── Password ─────────────────────────────────────────────────────
def _password_changed_mail(name: str) -> tuple[str, str]:
    link = f"{settings.FRONTEND_BASE_URL}/forgot-password"
    text = (
        f"Hello {name},\n\n"
        "The password of your VolunTag account was just changed in Settings. "
        "Every other device that was logged in has been logged out.\n\n"
        f"If this was not you, reset your password right away:\n{link}\n\n"
        "VolunTag"
    )
    html = (
        f"<p>Hello {escape(name)},</p>"
        "<p>The password of your VolunTag account was just changed in Settings. "
        "Every other device that was logged in has been logged out.</p>"
        f'<p>If this was not you, <a href="{escape(link, quote=True)}">reset your password</a> right away.</p>'
        "<p>VolunTag</p>"
    )
    return text, html


@router.post("/account/password")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    background: BackgroundTasks,
    session: UserSessionDB = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Change the password. Keeps this session and logs every other one out."""

    account = load_account(db, session)
    check_rate(
        session, request, _password_account_limiter,
        "Too many attempts. Please wait a while and try again.",
    )

    require_password(account, payload.current_password)

    problem = password_policy_error(payload.new_password or "")
    if problem:
        raise HTTPException(status_code=422, detail=problem)

    if verify_password(payload.new_password, account.password):
        raise HTTPException(status_code=422, detail=SAME_PASSWORD)

    account.password = hash_password(payload.new_password)
    revoked = revoke_other_sessions(db, session)
    # Reset links sent before the change no longer work.
    db.query(PasswordResetTokenDB).filter(
        PasswordResetTokenDB.user_role == session.user_role,
        PasswordResetTokenDB.user_id == session.user_id,
        PasswordResetTokenDB.used_at.is_(None),
    ).delete(synchronize_session=False)
    db.commit()

    logger.info("Password changed in Settings for %s id %s", session.user_role, session.user_id)

    text, html = _password_changed_mail(account.name)
    background.add_task(
        mailer.send_mail,
        account.email, "Your VolunTag password was changed", text, html,
        None, f"password-changed mail for {session.user_role} id {session.user_id}",
    )

    return {
        "message": "Password changed. Other devices have been logged out.",
        "sessions_revoked": revoked,
    }


# ─── Sessions ─────────────────────────────────────────────────────
@router.get("/account/sessions", response_model=list[SessionEntry])
def list_sessions(
    session: UserSessionDB = Depends(require_user),
    db: Session = Depends(get_db),
):
    """The account's live sessions, this one first, then the most recently used."""

    load_account(db, session)
    now = datetime.utcnow()
    rows = db.query(UserSessionDB).filter(
        UserSessionDB.user_role == session.user_role,
        UserSessionDB.user_id == session.user_id,
        UserSessionDB.expires_at > now,
    ).all()

    rows.sort(key=lambda row: (
        row.id != session.id,
        -(row.last_used_at or row.created_at).timestamp(),
    ))

    return [
        SessionEntry(
            id=row.id,
            device=row.device_label,
            created_at=_fmt_utc(row.created_at),
            last_used_at=_fmt_utc(row.last_used_at),
            expires_at=_fmt_utc(row.expires_at),
            current=row.id == session.id,
        )
        for row in rows
    ]


@router.post("/account/sessions/logout-others")
def logout_other_sessions(
    session: UserSessionDB = Depends(require_user),
    db: Session = Depends(get_db),
):
    load_account(db, session)
    revoked = revoke_other_sessions(db, session)
    db.commit()
    logger.info("%s id %s logged out %d other session(s)", session.user_role, session.user_id, revoked)
    return {"revoked": revoked}


# ─── Change email ─────────────────────────────────────────────────
EMAIL_CHANGE_MESSAGE = (
    "If this address can be used, we have sent a confirmation link to it. "
    "Your email changes only after you open that link."
)
SAME_EMAIL = "That is already your email address."

# Expired links are kept this long so the page can say "expired" rather than "invalid".
KEEP_EXPIRED = timedelta(days=7)

EMAIL_LINK_ERRORS = {
    "email_change_link_invalid": (
        "This link is not valid. Check that you opened the whole link from the email."
    ),
    "email_change_link_expired": (
        "This link has expired or was replaced by a newer one. "
        "Ask for a new one in Settings."
    ),
    "email_change_link_used": "This link has already been used, so your new address is active.",
    "email_change_unavailable": (
        "This address can no longer be used for your account. "
        "Choose another one in Settings."
    ),
}


def email_in_use(db: Session, email: str, role: str, account_id: int) -> bool:
    """True when any volunteer or NGO other than this account has the address."""
    for model in (VolunteerDB, NGODB):
        query = db.query(model.id).filter(model.email.isnot(None), func.lower(model.email) == email)
        if model is MODELS[role]:
            query = query.filter(model.id != account_id)
        if query.first():
            return True
    return False


def mask_email(email: str) -> str:
    """"asha@example.org" -> "a***@example.org" for notices to the old address."""
    local, _, domain = (email or "").partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def _confirm_mail(name: str, link: str, hours: int) -> tuple[str, str]:
    text = (
        f"Hello {name},\n\n"
        "You asked to use this address for your VolunTag account.\n\n"
        f"Open this link to confirm it:\n{link}\n\n"
        f"The link works once and is valid for {hours} hours. Until you open it, "
        "your account keeps its old address.\n"
        "If you did not ask for this, ignore this email.\n\n"
        "VolunTag"
    )
    html = (
        f"<p>Hello {escape(name)},</p>"
        "<p>You asked to use this address for your VolunTag account.</p>"
        f'<p><a href="{escape(link, quote=True)}">Confirm my new email address</a></p>'
        f"<p>The link works once and is valid for {hours} hours. Until you open it, "
        "your account keeps its old address.<br>If you did not ask for this, ignore this email.</p>"
        "<p>VolunTag</p>"
    )
    return text, html


def _changed_notice(name: str, new_email: str) -> str:
    return (
        f"Hello {name},\n\n"
        f"The email address of your VolunTag account was changed to {mask_email(new_email)}. "
        "From now on, log in with the new address. Every other device was logged out.\n\n"
        "If you did not make this change, contact us right away at "
        f"{settings.CONTACT_INBOX}.\n\n"
        "VolunTag"
    )


@router.post("/account/email")
def request_email_change(
    payload: ChangeEmailRequest,
    request: Request,
    background: BackgroundTasks,
    session: UserSessionDB = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Mail a confirmation link to the new address. The answer never says if it is taken."""

    account = load_account(db, session)
    check_rate(
        session, request, _email_change_limiter,
        "You have asked for several email changes. Please try again in an hour.",
    )
    require_password(account, payload.password)

    new_email = payload.new_email  # lowercased and format-checked by the schema
    if new_email == (account.email or "").strip().lower():
        raise HTTPException(status_code=422, detail=SAME_EMAIL)

    if email_in_use(db, new_email, session.user_role, account.id):
        # Nothing is sent and nothing changes; the answer is the same.
        logger.info("Email change for %s id %s refused: address in use", session.user_role, account.id)
        return {"message": EMAIL_CHANGE_MESSAGE}

    now = datetime.utcnow()
    db.query(EmailChangeTokenDB).filter(
        EmailChangeTokenDB.expires_at <= now - KEEP_EXPIRED,
    ).delete(synchronize_session=False)
    # Only the newest link works.
    db.query(EmailChangeTokenDB).filter(
        EmailChangeTokenDB.user_role == session.user_role,
        EmailChangeTokenDB.user_id == account.id,
        EmailChangeTokenDB.used_at.is_(None),
        EmailChangeTokenDB.expires_at > now,
    ).update({EmailChangeTokenDB.expires_at: now}, synchronize_session=False)

    token = secrets.token_urlsafe(32)
    hours = settings.EMAIL_CHANGE_HOURS
    db.add(EmailChangeTokenDB(
        token_hash=hash_token(token),
        user_role=session.user_role,
        user_id=account.id,
        old_email=(account.email or "").strip().lower(),
        new_email=new_email,
        created_at=now,
        expires_at=now + timedelta(hours=hours),
    ))
    db.commit()

    link = f"{settings.FRONTEND_BASE_URL}/confirm-email-change?token={token}"
    text, html = _confirm_mail(account.name, link, hours)
    background.add_task(
        mailer.send_mail,
        new_email, "Confirm your new VolunTag email address", text, html,
        None, f"email-change link for {session.user_role} id {account.id}",
    )
    logger.info("Email change requested for %s id %s", session.user_role, account.id)

    return {"message": EMAIL_CHANGE_MESSAGE}


def _link_error(code: str) -> JSONResponse:
    message = EMAIL_LINK_ERRORS[code]
    return JSONResponse(status_code=400, content={"code": code, "message": message, "detail": message})


@router.post("/confirm-email-change")
def confirm_email_change(
    payload: EmailChangeTokenRequest,
    request: Request,
    background: BackgroundTasks,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """Switch the account to the new address behind a link.

    Every session of the account ends, except the one sending this request
    (when it belongs to the same account), which moves to the new address.
    """

    _email_confirm_ip_limiter.check(
        rate_limit.client_ip(request),
        "Too many attempts. Please wait a few minutes and try again.",
    )

    token = payload.token or ""
    row = None
    if token:
        row = db.query(EmailChangeTokenDB).filter(EmailChangeTokenDB.token_hash == hash_token(token)).first()

    if row is None:
        return _link_error("email_change_link_invalid")
    if row.used_at is not None:
        return _link_error("email_change_link_used")

    now = datetime.utcnow()
    if row.expires_at <= now:
        return _link_error("email_change_link_expired")

    model = MODELS.get(row.user_role)
    account = db.query(model).filter(model.id == row.user_id).first() if model else None

    if account is None or is_deactivated(account):
        row.used_at = now
        db.commit()
        return _link_error("email_change_link_invalid")

    old_email = (account.email or "").strip().lower()
    if old_email != row.old_email:
        # The address changed some other way since this link was sent.
        row.expires_at = now
        db.commit()
        return _link_error("email_change_link_expired")

    new_email = row.new_email
    if email_in_use(db, new_email, row.user_role, account.id):
        row.used_at = now
        db.commit()
        return _link_error("email_change_unavailable")

    # The session sending this request stays, if it is this account's.
    keep_id = None
    bearer = _bearer_token(authorization)
    if bearer:
        mine = db.query(UserSessionDB).filter(
            UserSessionDB.token_hash == hash_token(bearer),
            UserSessionDB.user_role == row.user_role,
            UserSessionDB.user_id == row.user_id,
            UserSessionDB.expires_at > now,
        ).first()
        if mine is not None:
            keep_id = mine.id
            mine.email = new_email

    account.email = new_email
    # The link reached the new address, so it is confirmed.
    account.email_verified = 1
    row.used_at = now

    # Conversations and reports are keyed by address: move them along.
    db.query(MessageDB).filter(
        MessageDB.sender_role == row.user_role, func.lower(MessageDB.sender_email) == old_email,
    ).update({MessageDB.sender_email: new_email}, synchronize_session=False)
    db.query(MessageDB).filter(
        MessageDB.recipient_role == row.user_role, func.lower(MessageDB.recipient_email) == old_email,
    ).update({MessageDB.recipient_email: new_email}, synchronize_session=False)
    if row.user_role == "volunteer":
        db.query(IssueDB).filter(
            func.lower(IssueDB.reporter_email) == old_email,
        ).update({IssueDB.reporter_email: new_email}, synchronize_session=False)

    sessions = db.query(UserSessionDB).filter(
        UserSessionDB.user_role == row.user_role,
        UserSessionDB.user_id == row.user_id,
    )
    if keep_id is not None:
        sessions = sessions.filter(UserSessionDB.id != keep_id)
    sessions.delete(synchronize_session=False)

    # Links sent to the old address stop working.
    for table in (PasswordResetTokenDB, EmailVerificationTokenDB, EmailChangeTokenDB):
        db.query(table).filter(
            table.user_role == row.user_role,
            table.user_id == row.user_id,
            table.used_at.is_(None),
        ).update({table.used_at: now}, synchronize_session=False)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return _link_error("email_change_unavailable")

    logger.info("Email changed for %s id %s", row.user_role, row.user_id)

    background.add_task(
        mailer.send_mail,
        old_email, "Your VolunTag email address was changed", _changed_notice(account.name, new_email),
        None, None, f"email-changed notice for {row.user_role} id {row.user_id}",
    )

    return {
        "status": "changed",
        "role": row.user_role,
        "email": new_email,
        "kept_session": keep_id is not None,
        "message": "Your email address has been changed. Use it to log in from now on.",
    }


# ─── Download my data ─────────────────────────────────────────────
def _iso(dt):
    return dt.isoformat() + "Z" if dt else None


def _messages_sent(db: Session, role: str, email: str) -> list[dict]:
    rows = (
        db.query(MessageDB)
        .filter(MessageDB.sender_role == role, func.lower(MessageDB.sender_email) == email)
        .order_by(MessageDB.created_at, MessageDB.id)
        .all()
    )
    return [
        {
            "sent_at": _iso(m.created_at),
            "to_role": m.recipient_role,
            "to_email": m.recipient_email,
            "type": m.message_type,
            "text": m.body,
            "file_name": m.file_name,
            "latitude": m.latitude,
            "longitude": m.longitude,
            "read_at": _iso(m.read_at),
        }
        for m in rows
    ]


def _volunteer_export(db: Session, volunteer: VolunteerDB) -> dict:
    email = (volunteer.email or "").strip().lower()
    signups = (
        db.query(ActivitySignupDB, ActivityDB, NGODB)
        .join(ActivityDB, ActivitySignupDB.activity_id == ActivityDB.id)
        .join(NGODB, ActivityDB.ngo_id == NGODB.id)
        .filter(ActivitySignupDB.volunteer_id == volunteer.id)
        .order_by(ActivitySignupDB.created_at, ActivitySignupDB.id)
        .all()
    )
    issues = (
        db.query(IssueDB)
        .filter(func.lower(IssueDB.reporter_email) == email)
        .order_by(IssueDB.created_at, IssueDB.id)
        .all()
    )
    ratings = [s.rating for s, _, _ in signups if s.attendance_status == "attended" and s.rating]

    return {
        "profile": volunteer_profile(volunteer).model_dump(),
        "event_signups": [
            {
                "event_title": event.title,
                "ngo_name": ngo.name,
                "event_day": event_rules.event_day_text(event),
                "event_status": event.status,
                "phase": event_rules.event_phase(event),
                "signed_up_at": _iso(signup.created_at),
                "approved_at": _iso(signup.approved_at),
                "attendance": signup.attendance_status,
                "rating_received": signup.rating,
                "feedback_received": signup.feedback,
            }
            for signup, event, ngo in signups
        ],
        "ratings_received": {
            "count": len(ratings),
            "average": round(sum(ratings) / len(ratings), 2) if ratings else None,
        },
        "problems_reported": [
            {
                "complaint_id": issue.complaint_id,
                "description": issue.user_description,
                "location": issue.location,
                "status": issue.status,
                "photos": len(issue.image_paths or []),
                "reported_at": _iso(issue.created_at),
                "updated_at": _iso(issue.updated_at),
            }
            for issue in issues
        ],
        "messages_sent": _messages_sent(db, "volunteer", email),
    }


def _ngo_export(db: Session, ngo: NGODB) -> dict:
    email = (ngo.email or "").strip().lower()
    events = (
        db.query(ActivityDB)
        .filter(ActivityDB.ngo_id == ngo.id)
        .order_by(ActivityDB.created_at, ActivityDB.id)
        .all()
    )
    counts = {}
    for activity_id, approved_at in db.query(ActivitySignupDB.activity_id, ActivitySignupDB.approved_at).filter(
        ActivitySignupDB.activity_id.in_([e.id for e in events] or [0]),
    ):
        entry = counts.setdefault(activity_id, {"signups": 0, "approved": 0})
        entry["signups"] += 1
        entry["approved"] += approved_at is not None

    resolutions = (
        db.query(IssueResolutionDB)
        .filter(IssueResolutionDB.ngo_id == ngo.id)
        .order_by(IssueResolutionDB.submitted_at, IssueResolutionDB.id)
        .all()
    )

    profile = ngo_profile(ngo).model_dump()
    profile["work_photos"] = len(ngo.work_images or [])

    return {
        "profile": profile,
        "events": [
            {
                "title": event.title,
                "description": event.description,
                "required_skills": event.required_skills,
                "location": event.location,
                "event_day": event_rules.event_day_text(event),
                "status": event.status,
                "phase": event_rules.event_phase(event),
                "spots_available": event.spots_available,
                "created_at": _iso(event.created_at),
                # Counts only: who signed up is the volunteers' own data.
                "volunteers_signed_up": counts.get(event.id, {}).get("signups", 0),
                "volunteers_approved": counts.get(event.id, {}).get("approved", 0),
            }
            for event in events
        ],
        "problem_solutions_submitted": [
            {
                "complaint_id": r.complaint_id,
                "solution_type": r.solution_type,
                "solution_text": r.solution_text,
                "document_name": r.document_name,
                "status": r.status,
                "reject_reason": r.reject_reason,
                "submitted_at": _iso(r.submitted_at),
                "decided_at": _iso(r.decided_at),
            }
            for r in resolutions
        ],
        "messages_sent": _messages_sent(db, "ngo", email),
    }


@router.post("/account/export")
def export_my_data(
    payload: PasswordConfirmRequest,
    request: Request,
    session: UserSessionDB = Depends(require_user),
    db: Session = Depends(get_db),
):
    """The account's own data as a JSON file. No passwords, tokens or vectors."""

    account = load_account(db, session)
    check_rate(
        session, request, _export_limiter,
        "You have downloaded your data several times. Please try again in an hour.",
    )
    require_password(account, payload.password)

    now = datetime.utcnow()
    data = {
        "format": "voluntag-account-export",
        "version": 1,
        "exported_at": _iso(now),
        "account": {
            "role": session.user_role,
            "email": account.email,
            "email_confirmed": bool(account.email_verified),
        },
        **(_ngo_export(db, account) if session.user_role == "ngo" else _volunteer_export(db, account)),
    }

    logger.info("Data export for %s id %s", session.user_role, account.id)
    filename = f"voluntag-{session.user_role}-data-{now:%Y%m%d}.json"
    return JSONResponse(
        content=data,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


# ─── Deactivate ───────────────────────────────────────────────────
DEACTIVATE_WORD = "DEACTIVATE"


def upcoming_events(db: Session, ngo_id: int) -> list[ActivityDB]:
    """The NGO's events that are not cancelled and not completed yet."""
    events = db.query(ActivityDB).filter(
        ActivityDB.ngo_id == ngo_id,
        ActivityDB.status != "Cancelled",
    ).order_by(ActivityDB.event_date, ActivityDB.id).all()
    return [e for e in events if event_rules.event_phase(e) != event_rules.COMPLETED]


def _deactivated_mail(name: str) -> str:
    return (
        f"Hello {name},\n\n"
        "Your VolunTag account has been deactivated and every device was logged out. "
        "Nothing was deleted.\n\n"
        f"To use it again, contact us at {settings.CONTACT_INBOX}.\n\n"
        "VolunTag"
    )


@router.post("/account/deactivate")
def deactivate_account(
    payload: DeactivateRequest,
    request: Request,
    background: BackgroundTasks,
    session: UserSessionDB = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Soft deactivation: deactivated_at is set, sessions end, nothing is deleted."""

    account = load_account(db, session)
    # Read now: the session row itself is deleted below.
    role, user_id = session.user_role, session.user_id

    if payload.confirm != DEACTIVATE_WORD:
        raise HTTPException(status_code=422, detail=f"Type {DEACTIVATE_WORD} to confirm.")

    check_rate(
        session, request, _deactivate_limiter,
        "Too many attempts. Please wait a while and try again.",
    )
    require_password(account, payload.password)

    if role == "ngo":
        pending = upcoming_events(db, account.id)
        if pending:
            message = (
                f"Cancel your {len(pending)} upcoming "
                f"{'event' if len(pending) == 1 else 'events'} first, so the volunteers who "
                "joined are told. Then you can deactivate the account."
            )
            return JSONResponse(status_code=409, content={
                "code": "upcoming_events",
                "message": message,
                "detail": message,
                "upcoming_events": [
                    {"id": e.id, "title": e.title, "event_day": event_rules.event_day_text(e), "status": e.status}
                    for e in pending
                ],
            })

    now = datetime.utcnow()
    account.deactivated_at = now

    db.query(UserSessionDB).filter(
        UserSessionDB.user_role == role,
        UserSessionDB.user_id == user_id,
    ).delete(synchronize_session=False)
    for table in (PasswordResetTokenDB, EmailVerificationTokenDB, EmailChangeTokenDB):
        db.query(table).filter(
            table.user_role == role,
            table.user_id == user_id,
            table.used_at.is_(None),
        ).update({table.used_at: now}, synchronize_session=False)
    db.commit()

    logger.info("Account deactivated: %s id %s", role, user_id)
    background.add_task(
        mailer.send_mail,
        account.email, "Your VolunTag account was deactivated", _deactivated_mail(account.name),
        None, None, f"deactivated notice for {role} id {user_id}",
    )

    return {"message": "Your account has been deactivated. You have been logged out."}
