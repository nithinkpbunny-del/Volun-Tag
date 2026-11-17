"""Email verification at signup and registration without account enumeration."""

from datetime import datetime, timedelta

import pytest

import main
import password_hashing
import settings
from admin_auth import hash_token
from conftest import (
    PASSWORD, TEST_DATA_DIR, VERIFY_LINK, db_session, login, mail_text, mails_to,
    register_ngo, register_volunteer, verification_token,
)
from db_models import EmailVerificationTokenDB, NGODB, VolunteerDB


def volunteer_body(email="new@example.test", name="New Person", password=PASSWORD):
    return {
        "name": name, "email": email, "contact_number": "1", "password": password,
        "age": 20, "designation": "S", "gender": "F", "skills": "teaching",
        "location": "Pune", "availability": "Weekends",
    }


def ngo_form(email="org@example.test", name="Org"):
    return {
        "name": name, "email": email, "contact_number": "1", "password": PASSWORD,
        "category": "Education", "location": "Pune", "motto": "m", "legal_structure": "Trust",
    }


def account(model, email):
    db = db_session()
    try:
        return db.query(model).filter(model.email == email).first()
    finally:
        db.close()


def uploads_now():
    folder = TEST_DATA_DIR / "uploads"
    return sorted(p.name for p in folder.iterdir() if p.is_file())


# ─── Registration ─────────────────────────────────────────────────
def test_new_volunteer_starts_unverified_and_gets_a_link(client, mailbox):
    res = client.post("/add-volunteer", json=volunteer_body())
    assert res.status_code == 200
    assert res.json() == main.REGISTRATION_CHECK_EMAIL

    row = account(VolunteerDB, "new@example.test")
    assert row.email_verified == 0

    [message] = mails_to(mailbox, "new@example.test")
    assert message["Subject"] == "Confirm your VolunTag email address"
    assert f"{settings.FRONTEND_BASE_URL}/verify-email?token=" in mail_text(message)

    # Only the hash of the token is stored.
    token = verification_token(mailbox, "new@example.test")
    db = db_session()
    try:
        stored = db.query(EmailVerificationTokenDB).one()
        assert stored.token_hash == hash_token(token) and token not in stored.token_hash
        expected = timedelta(hours=settings.EMAIL_VERIFICATION_HOURS)
        assert abs((stored.expires_at - stored.created_at) - expected) < timedelta(seconds=5)
    finally:
        db.close()


def test_volunteer_registration_answer_does_not_depend_on_the_email(client, mailbox, monkeypatch):
    register_volunteer(client, "taken@example.test", name="Owner")
    mailbox.clear()

    hashed = []
    real_hash = main.hash_password
    monkeypatch.setattr(main, "hash_password", lambda p: hashed.append(p) or real_hash(p))

    new = client.post("/add-volunteer", json=volunteer_body("fresh@example.test", "Fresh"))
    taken = client.post("/add-volunteer", json=volunteer_body("TAKEN@example.test", "Someone Else"))

    assert new.status_code == taken.status_code == 200
    assert new.content == taken.content
    assert set(new.headers) == set(taken.headers)
    # The password is hashed on both paths (similar timing).
    assert len(hashed) == 2

    # No second account; the owner's password is unchanged.
    db = db_session()
    try:
        assert db.query(VolunteerDB).filter(VolunteerDB.email == "taken@example.test").count() == 1
    finally:
        db.close()
    login(client, "volunteer", "taken@example.test")

    # The owner gets a short notice with a reset link, not a confirmation link.
    [notice] = mails_to(mailbox, "taken@example.test")
    assert notice["Subject"] == "Someone tried to register with your email address"
    assert "/forgot-password?role=volunteer" in mail_text(notice)
    assert not VERIFY_LINK.search(mail_text(notice))


def test_ngo_registration_answer_does_not_depend_on_the_email(client, mailbox):
    register_ngo(client, "org@example.test", name="Org")
    mailbox.clear()
    before = uploads_now()

    image = ("work_images", ("p.png", __import__("conftest").png_bytes(), "image/png"))
    new = client.post("/add-ngo", data=ngo_form("other@example.test", "Other"), files=[image])
    taken = client.post("/add-ngo", data=ngo_form("org@example.test", "Org Two"), files=[image])

    assert new.status_code == taken.status_code == 200
    assert new.content == taken.content
    assert account(NGODB, "other@example.test").email_verified == 0
    # The duplicate's upload was not kept; the new NGO's was.
    assert len(uploads_now()) == len(before) + 1
    assert [m["Subject"] for m in mails_to(mailbox, "org@example.test")] == [
        "Someone tried to register with your email address",
    ]


def test_validation_errors_still_show(client):
    weak = client.post("/add-volunteer", json=volunteer_body(password="short"))
    assert weak.status_code == 422 and "Password must have" in weak.json()["detail"]

    missing = client.post("/add-volunteer", json={"email": "x@example.test"})
    assert missing.status_code == 422

    bad_email = client.post("/add-volunteer", json=volunteer_body(email="not-an-email"))
    assert bad_email.status_code == 422

    ngo = client.post("/add-ngo", data={**ngo_form(), "password": "short"})
    assert ngo.status_code == 422


def test_taken_name_with_a_new_email_is_still_reported(client):
    register_volunteer(client, "a@example.test", name="Same Name")
    res = client.post("/add-volunteer", json=volunteer_body("b@example.test", "same name"))
    assert res.status_code == 400 and "already exists" in res.json()["detail"]


def test_notice_mails_are_rate_limited_per_address(client, mailbox, monkeypatch):
    register_volunteer(client, "taken@example.test", name="Owner")
    mailbox.clear()
    monkeypatch.setattr(main.volunteer_signup_limiter, "limit", 100)

    answers = set()
    for i in range(settings.REGISTER_NOTICE_LIMIT_PER_DAY + 3):
        res = client.post("/add-volunteer", json=volunteer_body("taken@example.test", f"X{i}"))
        answers.add((res.status_code, res.content))

    assert len(answers) == 1
    assert len(mails_to(mailbox, "taken@example.test")) == settings.REGISTER_NOTICE_LIMIT_PER_DAY


def test_registering_again_while_unverified_sends_a_fresh_link(client, mailbox):
    client.post("/add-volunteer", json=volunteer_body())
    first = verification_token(mailbox, "new@example.test")

    client.post("/add-volunteer", json=volunteer_body(name="Another Name"))
    second = verification_token(mailbox, "new@example.test")
    assert first != second

    assert client.post("/verify-email", json={"token": first}).json()["code"] == "verification_link_expired"
    assert client.post("/verify-email", json={"token": second}).status_code == 200


def test_verification_off_creates_verified_accounts_with_the_old_answer(client, mailbox, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_REQUIRED", False)

    res = client.post("/add-volunteer", json=volunteer_body())
    assert res.status_code == 200
    assert res.json()["verification_required"] is False and "total_volunteers" in res.json()
    assert mailbox == []
    login(client, "volunteer", "new@example.test")

    res = client.post("/add-ngo", data=ngo_form())
    assert res.status_code == 200 and res.json()["verification_required"] is False
    login(client, "ngo", "org@example.test")
    assert client.post("/add-ngo", data=ngo_form(name="Other")).status_code == 400


# ─── Verify ───────────────────────────────────────────────────────
def test_verify_then_login(client, mailbox):
    client.post("/add-volunteer", json=volunteer_body())
    token = verification_token(mailbox, "new@example.test")

    res = client.post("/verify-email", json={"token": token})
    assert res.status_code == 200
    assert res.json()["status"] == "verified" and res.json()["role"] == "volunteer"
    assert account(VolunteerDB, "new@example.test").email_verified == 1
    login(client, "volunteer", "new@example.test")

    again = client.post("/verify-email", json={"token": token})
    assert again.status_code == 400
    assert again.json()["code"] == "verification_link_used"
    assert again.json()["message"] == again.json()["detail"]


def test_expired_and_invalid_links(client, mailbox):
    client.post("/add-ngo", data=ngo_form())
    token = verification_token(mailbox, "org@example.test")

    db = db_session()
    try:
        row = db.query(EmailVerificationTokenDB).one()
        row.expires_at = datetime.utcnow() - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()

    res = client.post("/verify-email", json={"token": token})
    assert res.status_code == 400 and res.json()["code"] == "verification_link_expired"
    assert account(NGODB, "org@example.test").email_verified == 0

    for bad in ("", "nope", "x" * 300):
        res = client.post("/verify-email", json={"token": bad})
        assert res.status_code in (400, 422)
        if res.status_code == 400:
            assert res.json()["code"] == "verification_link_invalid"


def test_verify_is_rate_limited_per_ip(client):
    for _ in range(settings.VERIFY_LIMIT_PER_IP_PER_10_MIN):
        assert client.post("/verify-email", json={"token": "guess"}).status_code == 400
    res = client.post("/verify-email", json={"token": "guess"})
    assert res.status_code == 429 and "Retry-After" in res.headers


# ─── Login before verifying ───────────────────────────────────────
def test_unverified_login_is_refused_only_with_the_right_password(client, mailbox):
    client.post("/add-volunteer", json=volunteer_body())

    wrong = client.post("/volunteer-login", json={"email": "new@example.test", "password": "Wrong#12345"})
    unknown = client.post("/volunteer-login", json={"email": "ghost@example.test", "password": "Wrong#12345"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.content == unknown.content

    right = client.post("/volunteer-login", json={"email": "new@example.test", "password": PASSWORD})
    assert right.status_code == 403
    assert right.json()["code"] == "email_not_verified"
    assert "token" not in right.json()

    db = db_session()
    try:
        from db_models import UserSessionDB
        assert db.query(UserSessionDB).count() == 0  # no session issued
    finally:
        db.close()


def test_unverified_ngo_login_refused(client, mailbox):
    client.post("/add-ngo", data=ngo_form())
    res = client.post("/ngo-login", json={"email": "org@example.test", "password": PASSWORD})
    assert res.status_code == 403 and res.json()["code"] == "email_not_verified"


# ─── Resend ───────────────────────────────────────────────────────
def test_resend_is_generic_and_only_mails_unverified_accounts(client, mailbox):
    client.post("/add-volunteer", json=volunteer_body())
    register_volunteer(client, "done@example.test", name="Done")
    mailbox.clear()

    answers = [
        client.post("/resend-verification", json={"role": "volunteer", "email": e})
        for e in ("new@example.test", "done@example.test", "ghost@example.test", "bad email")
    ]
    assert {a.status_code for a in answers} == {200}
    assert len({a.content for a in answers}) == 1

    assert [m["To"] for m in mailbox] == ["new@example.test"]
    token = verification_token(mailbox, "new@example.test")
    assert client.post("/verify-email", json={"token": token}).status_code == 200

    bad_role = client.post("/resend-verification", json={"role": "admin", "email": "x@example.test"})
    assert bad_role.status_code == 422


def test_resend_limits(client, mailbox):
    client.post("/add-volunteer", json=volunteer_body())
    mailbox.clear()

    answers = {
        client.post("/resend-verification", json={"role": "volunteer", "email": "new@example.test"}).content
        for _ in range(settings.RESEND_LIMIT_PER_ACCOUNT_PER_HOUR + 2)
    }
    assert len(answers) == 1  # over the per-account limit: same answer, nothing sent
    assert len(mailbox) == settings.RESEND_LIMIT_PER_ACCOUNT_PER_HOUR

    for i in range(settings.RESEND_LIMIT_PER_IP_PER_HOUR - settings.RESEND_LIMIT_PER_ACCOUNT_PER_HOUR - 2):
        client.post("/resend-verification", json={"role": "ngo", "email": f"n{i}@example.test"})
    res = client.post("/resend-verification", json={"role": "ngo", "email": "last@example.test"})
    assert res.status_code == 429


def test_password_reset_also_confirms_the_email(client, mailbox):
    client.post("/add-volunteer", json=volunteer_body())
    mailbox.clear()
    client.post("/forgot-password", json={"role": "volunteer", "email": "new@example.test"})
    import re
    token = re.search(r"token=([A-Za-z0-9_\-]+)", mail_text(mailbox[0])).group(1)
    res = client.post("/reset-password", json={"token": token, "new_password": "Brand#New123"})
    assert res.status_code == 200
    login(client, "volunteer", "new@example.test", "Brand#New123")


@pytest.mark.parametrize("role", ["volunteer", "ngo"])
def test_mail_failure_does_not_change_the_answer(client, mailbox, role):
    mailbox.fail = True
    if role == "volunteer":
        res = client.post("/add-volunteer", json=volunteer_body())
    else:
        res = client.post("/add-ngo", data=ngo_form())
    assert res.status_code == 200 and res.json() == main.REGISTRATION_CHECK_EMAIL
    mailbox.fail = False
