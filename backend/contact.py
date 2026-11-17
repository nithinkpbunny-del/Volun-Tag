"""Public contact form (design: analysis file 03).

POST /contact ALWAYS stores the message in contact_messages first; admins
read it in the admin console ("Contact messages"). Only when
CONTACT_SEND_EMAIL is true (default false) is it also mailed to
CONTACT_INBOX (Reply-To = the visitor), after the row is committed and in a
background task, so mail can never lose or fail the stored message. The
answer is always 201 {"message": "received"} once the input is valid:

* a filled honeypot field ("website") is accepted and dropped silently;
* an identical message from the same email within 24 hours is dropped;
* if mail is off or down the row is kept (mail_sent = 0), nothing is lost.

Limits: CONTACT_LIMIT_PER_HOUR_PER_IP (3) and CONTACT_LIMIT_PER_DAY_PER_EMAIL
(3) -> 429. There is no auto-reply: replying to any typed-in address would
turn the form into a spam relay.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session

try:
    from . import mailer, rate_limit, settings
    from .database import SessionLocal, get_db
    from .db_models import ContactMessageDB
    from .schemas import ContactRequest
except ImportError:
    import mailer, rate_limit, settings
    from database import SessionLocal, get_db
    from db_models import ContactMessageDB
    from schemas import ContactRequest


logger = logging.getLogger(__name__)

router = APIRouter(tags=["contact"])

RECEIVED = {"message": "received"}
DUPLICATE_WINDOW = timedelta(hours=24)

_ip_limiter = rate_limit.make_limiter(settings.CONTACT_LIMIT_PER_HOUR_PER_IP, 3600, "contact-ip")
_email_limiter = rate_limit.make_limiter(
    settings.CONTACT_LIMIT_PER_DAY_PER_EMAIL, 24 * 3600, "contact-email",
)

_salt = settings.IP_HASH_SALT or secrets.token_hex(16)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _send_to_inbox(message_id: int) -> None:
    """Background job: mail one stored message and mark it sent."""
    db = SessionLocal()
    try:
        row = db.query(ContactMessageDB).filter(ContactMessageDB.id == message_id).first()
        if row is None:
            return

        role = row.role or "not given"
        text = (
            f"New message from the VolunTag contact form\n\n"
            f"Name:    {row.name}\n"
            f"Email:   {row.email}\n"
            f"I am a:  {role}\n"
            f"Subject: {row.subject or '(none)'}\n"
            f"Sent:    {row.created_at:%Y-%m-%d %H:%M} UTC\n\n"
            f"{row.message}\n"
        )
        subject = f"[VolunTag contact] {row.subject or 'New message'}"

        if mailer.send_mail(
            settings.CONTACT_INBOX, subject, text,
            reply_to=row.email, log_label=f"contact message {row.id}",
        ):
            row.mail_sent = 1
            db.commit()
    except Exception:
        logger.exception("Could not process contact message %s", message_id)
    finally:
        db.close()


@router.post("/contact", status_code=201)
def submit_contact(
    payload: ContactRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # Bots fill the hidden field; they get the normal answer and nothing is stored.
    if payload.website and payload.website.strip():
        logger.info("Contact form honeypot triggered; message dropped")
        return RECEIVED

    ip = rate_limit.client_ip(request)

    _ip_limiter.check(ip, "You have sent several messages. Please try again in an hour.")
    _email_limiter.check(
        payload.email,
        "You have sent several messages today. Please try again tomorrow.",
    )

    content_hash = _sha256(payload.email + "\n" + payload.message)
    since = datetime.utcnow() - DUPLICATE_WINDOW

    duplicate = (
        db.query(ContactMessageDB.id)
        .filter(
            ContactMessageDB.content_hash == content_hash,
            ContactMessageDB.created_at >= since,
        )
        .first()
    )
    if duplicate:
        return RECEIVED

    row = ContactMessageDB(
        name=payload.name,
        email=payload.email,
        subject=payload.subject,
        message=payload.message,
        role=payload.role,
        ip_hash=_sha256(_salt + ip),
        content_hash=content_hash,
        status="new",
        mail_sent=0,
    )
    db.add(row)
    db.commit()

    # Mail is an optional copy. It runs after the commit, in the background,
    # and _send_to_inbox never raises, so the visitor's answer and the stored
    # row do not depend on it.
    if settings.CONTACT_SEND_EMAIL:
        try:
            background.add_task(_send_to_inbox, row.id)
        except Exception:
            logger.exception("Could not queue mail for contact message %s", row.id)

    return RECEIVED
