"""Outgoing mail through plain SMTP (stdlib only, no new dependency).

Development: Mailpit on 127.0.0.1:1025 catches everything (web inbox on
http://127.0.0.1:8025). Hosting: point the SMTP_* settings at a real provider.

send_mail() never raises: a failure is logged (without tokens or links) and
False is returned, so callers can keep their HTTP answer unchanged. Tests
swap the transport with set_transport().
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Callable, Optional

try:
    from . import settings
except ImportError:
    import settings


logger = logging.getLogger(__name__)


def _smtp_transport(message: EmailMessage) -> None:
    timeout = settings.SMTP_TIMEOUT_SECONDS

    if settings.SMTP_SSL:
        server = smtplib.SMTP_SSL(
            settings.SMTP_HOST, settings.SMTP_PORT,
            timeout=timeout, context=ssl.create_default_context(),
        )
    else:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout)

    try:
        if settings.SMTP_STARTTLS and not settings.SMTP_SSL:
            server.starttls(context=ssl.create_default_context())
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.send_message(message)
    finally:
        try:
            server.quit()
        except Exception:
            pass


_transport: Callable[[EmailMessage], None] = _smtp_transport


def set_transport(transport: Optional[Callable[[EmailMessage], None]]) -> None:
    """Replace how messages are delivered (None restores SMTP)."""
    global _transport
    _transport = _smtp_transport if transport is None else transport


def _clean_header(value: str) -> str:
    """Headers never carry line breaks (header injection)."""
    return " ".join((value or "").replace("\r", " ").replace("\n", " ").split())


def build_message(
    to: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = _clean_header(settings.MAIL_FROM)
    message["To"] = _clean_header(to)
    message["Subject"] = _clean_header(subject)
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain="voluntag.local")
    if reply_to:
        message["Reply-To"] = _clean_header(reply_to)

    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    return message


def send_mail(
    to: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    reply_to: Optional[str] = None,
    log_label: str = "mail",
) -> bool:
    """Send one message. Returns True when the transport accepted it."""

    if not settings.MAIL_ENABLED:
        logger.info("MAIL_ENABLED is off; %s not sent", log_label)
        return False

    try:
        _transport(build_message(to, subject, text_body, html_body, reply_to))
    except Exception as exc:  # network, auth, refused recipient, ...
        logger.warning("Could not send %s: %s", log_label, type(exc).__name__)
        return False

    logger.info("Sent %s", log_label)
    return True
