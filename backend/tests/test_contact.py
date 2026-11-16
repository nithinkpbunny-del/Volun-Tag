"""POST /contact: stored, mailed, honeypot, duplicates, limits, mail down."""

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


def test_stored_and_mailed(client, mailbox):
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


def test_mail_down_keeps_row(client, mailbox):
    mailbox.fail = True
    assert client.post("/contact", json=BODY).status_code == 201
    [row] = rows()
    assert row.mail_sent == 0
