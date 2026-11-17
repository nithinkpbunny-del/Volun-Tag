"""POST /contact: stored (always), mailed (only if enabled), honeypot, duplicates, limits, mail down."""

import pytest

import contact
import settings
from conftest import db_session
from db_models import ContactMessageDB

BODY = {
    "name": "Asha", "email": "Asha@Example.test", "subject": "Hello\r\nBcc: evil@example.test",
    "message": "I would like to know more about volunteering.", "role": "volunteer",
}


def rows():
    db = db_session()
    try:
        return db.query(ContactMessageDB).all()
    finally:
        db.close()


@pytest.fixture
def email_on(monkeypatch):
    monkeypatch.setattr(settings, "CONTACT_SEND_EMAIL", True)


def test_email_off_by_default():
    assert settings.CONTACT_SEND_EMAIL is False


def test_stored_without_email_by_default(client, mailbox):
    res = client.post("/contact", json=BODY)
    assert res.status_code == 201 and res.json() == {"message": "received"}
    [row] = rows()
    assert row.name == "Asha" and row.email == "asha@example.test"
    assert row.subject == "Hello Bcc: evil@example.test"
    assert row.message == BODY["message"] and row.role == "volunteer"
    assert row.created_at is not None and row.ip_hash and row.content_hash
    assert row.mail_sent == 0 and row.read_at is None and row.archived_at is None
    assert mailbox == []


def test_stored_and_mailed(client, mailbox, email_on):
    res = client.post("/contact", json=BODY)
    assert res.status_code == 201 and res.json() == {"message": "received"}
    [row] = rows()
    assert row.email == "asha@example.test" and row.subject == "Hello Bcc: evil@example.test"
    assert row.ip_hash and "testclient" not in row.ip_hash and row.mail_sent == 1
    [mail] = mailbox
    assert mail["To"] == settings.CONTACT_INBOX
    assert mail["Reply-To"] == "asha@example.test"
    assert "\n" not in mail["Subject"] and mail.get("Bcc") is None


def test_honeypot(client, mailbox):
    res = client.post("/contact", json={**BODY, "website": "http://spam.example"})
    assert res.status_code == 201 and rows() == [] and mailbox == []


def test_duplicate_dropped(client, mailbox):
    client.post("/contact", json=BODY)
    assert client.post("/contact", json=BODY).status_code == 201
    assert len(rows()) == 1


def test_validation(client):
    assert client.post("/contact", json={**BODY, "message": "short"}).status_code == 422
    assert client.post("/contact", json={**BODY, "email": "nope"}).status_code == 422
    assert client.post("/contact", json={**BODY, "name": "A"}).status_code == 422
    assert client.post("/contact", json={**BODY, "message": "x" * 2001}).status_code == 422


def test_ip_limit(client):
    for i in range(settings.CONTACT_LIMIT_PER_HOUR_PER_IP):
        assert client.post("/contact", json={**BODY, "email": f"p{i}@example.test"}).status_code == 201
    assert client.post("/contact", json={**BODY, "email": "late@example.test"}).status_code == 429


def test_mail_down_keeps_row(client, mailbox, email_on):
    mailbox.fail = True
    res = client.post("/contact", json=BODY)
    assert res.status_code == 201 and res.json() == {"message": "received"}
    [row] = rows()
    assert row.mail_sent == 0 and row.message == BODY["message"]


def test_mail_crash_keeps_row(client, monkeypatch, email_on):
    """Even an unexpected exception in the mail step cannot lose the message."""

    def boom(*args, **kwargs):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(contact.mailer, "send_mail", boom)
    res = client.post("/contact", json=BODY)
    assert res.status_code == 201 and res.json() == {"message": "received"}
    [row] = rows()
    assert row.mail_sent == 0


def test_stored_before_mail_is_attempted(client, monkeypatch, email_on):
    seen = []

    def check(to, subject, text, **kwargs):
        seen.append([r.message for r in rows()])
        return True

    monkeypatch.setattr(contact.mailer, "send_mail", check)
    client.post("/contact", json=BODY)
    assert seen == [[BODY["message"]]]


def test_honeypot_with_email_on(client, mailbox, email_on):
    client.post("/contact", json={**BODY, "website": "x"})
    assert rows() == [] and mailbox == []
