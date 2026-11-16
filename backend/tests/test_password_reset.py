"""Forgot / reset password (file 02 test list)."""

import re
from datetime import datetime, timedelta

from conftest import PASSWORD, auth, db_session, login, register_ngo, register_volunteer
from db_models import PasswordResetTokenDB

NEW = "Fresh@67890"


def token_from(mailbox):
    body = mailbox[-1].get_body(("plain",)).get_content()
    return re.search(r"token=([A-Za-z0-9_\-]+)", body).group(1)


def test_known_and_unknown_get_identical_answers(client, mailbox):
    register_volunteer(client, "vol@example.test")
    a = client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"})
    b = client.post("/forgot-password", json={"role": "volunteer", "email": "nobody@example.test"})
    c = client.post("/forgot-password", json={"role": "ngo", "email": "not an email"})
    assert a.status_code == b.status_code == c.status_code == 200
    assert a.content == b.content == c.content
    assert len(mailbox) == 1
    assert mailbox[0]["To"] == "vol@example.test"
    assert mailbox[0]["Subject"] == "Reset your VolunTag password"
    assert "http://localhost:3000/reset-password?token=" in mailbox[0].get_body(("plain",)).get_content()
    assert client.post("/forgot-password", json={"role": "admin", "email": "x"}).status_code == 422


def test_only_the_hash_is_stored(client, mailbox):
    register_volunteer(client, "vol@example.test")
    client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"})
    token = token_from(mailbox)
    db = db_session()
    rows = db.query(PasswordResetTokenDB).all()
    db.close()
    assert len(rows) == 1 and rows[0].token_hash != token and len(rows[0].token_hash) == 64


def test_full_reset_revokes_sessions_and_works_once(client, mailbox):
    register_volunteer(client, "vol@example.test")
    old_session = login(client, "volunteer", "vol@example.test")

    client.post("/forgot-password", json={"role": "volunteer", "email": "VOL@example.test"})
    token = token_from(mailbox)
    assert client.post("/reset-password/verify", json={"token": token}).json() == {"valid": True}

    weak = client.post("/reset-password", json={"token": token, "new_password": "short"})
    assert weak.status_code == 422
    # The weak attempt did not use up the link.
    assert client.post("/reset-password/verify", json={"token": token}).json() == {"valid": True}

    res = client.post("/reset-password", json={"token": token, "new_password": NEW})
    assert res.status_code == 200 and res.json()["message"] == "Password updated. Please log in."
    assert mailbox[-1]["Subject"] == "Your VolunTag password was changed"

    assert client.get("/session", headers=auth(old_session)).status_code == 401
    assert client.post("/volunteer-login", json={"email": "vol@example.test", "password": PASSWORD}).status_code == 401
    login(client, "volunteer", "vol@example.test", NEW)

    again = client.post("/reset-password", json={"token": token, "new_password": "Other@12345"})
    assert again.status_code == 400 and again.json()["detail"] == "This link is invalid or has expired."


def test_newest_link_only(client, mailbox):
    register_volunteer(client, "vol@example.test")
    client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"})
    first = token_from(mailbox)
    client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"})
    second = token_from(mailbox)
    assert client.post("/reset-password/verify", json={"token": first}).json()["valid"] is False
    assert client.post("/reset-password/verify", json={"token": second}).json()["valid"] is True


def test_expired_link(client, mailbox):
    register_volunteer(client, "vol@example.test")
    client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"})
    token = token_from(mailbox)
    db = db_session()
    db.query(PasswordResetTokenDB).update({"expires_at": datetime.utcnow() - timedelta(seconds=1)})
    db.commit()
    db.close()
    assert client.post("/reset-password", json={"token": token, "new_password": NEW}).status_code == 400


def test_role_is_respected(client, mailbox):
    # Same address as volunteer and NGO: a volunteer link changes only the volunteer.
    register_volunteer(client, "both@example.test")
    register_ngo(client, "both@example.test", name="Both NGO")
    client.post("/forgot-password", json={"role": "volunteer", "email": "both@example.test"})
    token = token_from(mailbox)
    assert client.post("/reset-password", json={"token": token, "new_password": NEW}).status_code == 200
    login(client, "volunteer", "both@example.test", NEW)
    login(client, "ngo", "both@example.test", PASSWORD)


def test_passwordless_seed_account_can_set_password(client, mailbox):
    from db_models import VolunteerDB
    register_volunteer(client, "seed@example.test")
    db = db_session()
    db.query(VolunteerDB).update({"password": None})
    db.commit()
    db.close()
    client.post("/forgot-password", json={"role": "volunteer", "email": "seed@example.test"})
    assert client.post("/reset-password", json={"token": token_from(mailbox), "new_password": NEW}).status_code == 200
    login(client, "volunteer", "seed@example.test", NEW)


def test_request_limit_is_silent(client, mailbox):
    register_volunteer(client, "vol@example.test")
    answers = {client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"}).content for _ in range(5)}
    assert len(answers) == 1
    assert len(mailbox) == 3  # 3 per hour per account


def test_submit_limit(client):
    codes = [client.post("/reset-password", json={"token": "x", "new_password": NEW}).status_code for _ in range(11)]
    assert codes[:10] == [400] * 10 and codes[10] == 429


def test_mail_down_does_not_change_answer(client, mailbox):
    register_volunteer(client, "vol@example.test")
    mailbox.fail = True
    res = client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"})
    assert res.status_code == 200 and res.json()["message"].startswith("If an account exists")


def test_unlocks_login_after_reset(client, mailbox):
    register_volunteer(client, "vol@example.test")
    for _ in range(5):
        client.post("/volunteer-login", json={"email": "vol@example.test", "password": "Wrong@12345"})
    client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"})
    client.post("/reset-password", json={"token": token_from(mailbox), "new_password": NEW})
    login(client, "volunteer", "vol@example.test", NEW)
