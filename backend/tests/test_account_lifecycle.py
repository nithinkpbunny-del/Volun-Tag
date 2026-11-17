"""Settings, part 2: change email, download my data, deactivate (+ admin reactivate)."""

import json
import re
from datetime import datetime, timedelta

import pytest

import settings
from conftest import (
    PASSWORD, admin_token, auth, db_session, login, mail_text, mails_to, register_ngo,
    register_volunteer,
)
from db_models import (
    ActivityDB, ActivitySignupDB, AdminActionDB, EmailChangeTokenDB, MessageDB, NGODB,
    UserSessionDB, VolunteerDB,
)

CHANGE_LINK = re.compile(r"/confirm-email-change\?token=([A-Za-z0-9_\-]+)")
GENERIC = (
    "If this address can be used, we have sent a confirmation link to it. "
    "Your email changes only after you open that link."
)


def change_token(mailbox, email):
    for message in reversed(mails_to(mailbox, email)):
        found = CHANGE_LINK.search(mail_text(message))
        if found:
            return found.group(1)
    raise AssertionError(f"no email-change mail for {email}")


def request_change(client, token, new_email, password=PASSWORD):
    return client.post("/account/email", json={"password": password, "new_email": new_email}, headers=auth(token))


def stored(model, **filters):
    db = db_session()
    try:
        return db.query(model).filter_by(**filters).first()
    finally:
        db.close()


def run_sql(fn):
    db = db_session()
    try:
        fn(db)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def volunteer(client):
    register_volunteer(client, "vol@example.test", name="Asha", skills="Teaching, tutoring, literacy")
    return login(client, "volunteer", "vol@example.test")


@pytest.fixture
def ngo(client):
    register_ngo(client, "org@example.test", name="Read Trust", category="Education")
    return login(client, "ngo", "org@example.test")


# ─── Change email ─────────────────────────────────────────────────
def test_email_changes_only_after_the_link_is_opened(client, volunteer, ngo, mailbox):
    other = login(client, "volunteer", "vol@example.test")
    client.post("/messages", json={"sender_email": "vol@example.test", "recipient_email": "org@example.test", "body": "hi"}, headers=auth(volunteer))

    res = request_change(client, volunteer, "  New@Example.TEST ")
    assert res.status_code == 200 and res.json() == {"message": GENERIC}

    # Link to the NEW address only; nothing has changed yet.
    assert mails_to(mailbox, "vol@example.test") == []
    token = change_token(mailbox, "new@example.test")
    assert stored(VolunteerDB, name="Asha").email == "vol@example.test"
    login(client, "volunteer", "vol@example.test")

    done = client.post("/confirm-email-change", json={"token": token}, headers=auth(volunteer))
    assert done.status_code == 200, done.text
    assert done.json()["email"] == "new@example.test" and done.json()["kept_session"] is True

    assert stored(VolunteerDB, name="Asha").email == "new@example.test"
    # The session that confirmed stays and moves to the new address; the others end.
    assert client.get("/session", headers=auth(volunteer)).json()["email"] == "new@example.test"
    assert client.get("/session", headers=auth(other)).status_code == 401

    assert client.post("/volunteer-login", json={"email": "vol@example.test", "password": PASSWORD}).status_code == 401
    login(client, "volunteer", "new@example.test")

    notice = mails_to(mailbox, "vol@example.test")
    assert len(notice) == 1 and "n***@example.test" in mail_text(notice[0])
    assert token not in mail_text(notice[0])

    # Conversations follow the address.
    assert stored(MessageDB, body="hi").sender_email == "new@example.test"

    used = client.post("/confirm-email-change", json={"token": token})
    assert used.status_code == 400 and used.json()["code"] == "email_change_link_used"


def test_confirming_in_another_browser_ends_every_session(client, volunteer, mailbox):
    request_change(client, volunteer, "new@example.test")
    done = client.post("/confirm-email-change", json={"token": change_token(mailbox, "new@example.test")})
    assert done.status_code == 200 and done.json()["kept_session"] is False
    assert client.get("/session", headers=auth(volunteer)).status_code == 401


@pytest.mark.parametrize("taken_by", ["volunteer", "ngo"])
def test_taken_address_gets_the_same_answer_and_nothing_is_sent(client, volunteer, mailbox, taken_by):
    if taken_by == "volunteer":
        register_volunteer(client, "taken@example.test", name="Bina")
    else:
        register_ngo(client, "taken@example.test", name="Other NGO")
    mailbox.clear()

    taken = request_change(client, volunteer, "TAKEN@example.test")
    free = request_change(client, volunteer, "free@example.test")
    assert (taken.status_code, taken.json()) == (free.status_code, free.json()) == (200, {"message": GENERIC})

    assert mails_to(mailbox, "taken@example.test") == []
    assert len(mails_to(mailbox, "free@example.test")) == 1
    assert stored(EmailChangeTokenDB, new_email="taken@example.test") is None
    assert stored(VolunteerDB, name="Asha").email == "vol@example.test"


def test_change_email_errors(client, volunteer, mailbox):
    wrong = request_change(client, volunteer, "new@example.test", password="Wrong#Pass1")
    assert wrong.status_code == 400 and wrong.json()["detail"] == "The password you entered is not correct."
    assert request_change(client, volunteer, "not-an-email").status_code == 422
    assert request_change(client, volunteer, "VOL@example.test").status_code == 422
    assert mailbox == []
    assert client.post("/account/email", json={"password": PASSWORD, "new_email": "x@example.test"}).status_code == 401


def test_change_email_is_rate_limited(client, volunteer):
    for n in range(settings.EMAIL_CHANGE_LIMIT_PER_HOUR):
        assert request_change(client, volunteer, f"n{n}@example.test").status_code == 200
    assert request_change(client, volunteer, "late@example.test").status_code == 429


def test_expired_superseded_and_invalid_links(client, volunteer, mailbox):
    request_change(client, volunteer, "first@example.test")
    first = change_token(mailbox, "first@example.test")
    request_change(client, volunteer, "second@example.test")
    second = change_token(mailbox, "second@example.test")

    # A newer request replaces the older link.
    res = client.post("/confirm-email-change", json={"token": first})
    assert res.status_code == 400 and res.json()["code"] == "email_change_link_expired"

    run_sql(lambda db: db.query(EmailChangeTokenDB).update({"expires_at": datetime.utcnow() - timedelta(minutes=1)}))
    res = client.post("/confirm-email-change", json={"token": second})
    assert res.status_code == 400 and res.json()["code"] == "email_change_link_expired"

    for bad in ("", "nope", "x" * 200):
        res = client.post("/confirm-email-change", json={"token": bad})
        assert res.status_code == 400 and res.json()["code"] == "email_change_link_invalid"
    assert client.post("/confirm-email-change", json={"token": "x" * 201}).status_code == 422
    assert stored(VolunteerDB, name="Asha").email == "vol@example.test"


def test_address_taken_before_the_link_is_opened(client, volunteer, mailbox):
    request_change(client, volunteer, "race@example.test")
    token = change_token(mailbox, "race@example.test")
    register_volunteer(client, "race@example.test", name="Racer")

    res = client.post("/confirm-email-change", json={"token": token})
    assert res.status_code == 400 and res.json()["code"] == "email_change_unavailable"
    assert stored(VolunteerDB, name="Asha").email == "vol@example.test"


def test_only_the_hash_of_the_link_is_stored(client, volunteer, mailbox):
    request_change(client, volunteer, "new@example.test")
    token = change_token(mailbox, "new@example.test")
    row = stored(EmailChangeTokenDB, new_email="new@example.test")
    assert row.token_hash != token and len(row.token_hash) == 64


# ─── Download my data ─────────────────────────────────────────────
def test_volunteer_export_has_own_data_and_nothing_secret(client, volunteer, ngo, freeze_today):
    freeze_today("2026-11-16 10:00")
    eid = client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching, tutoring, literacy", "event_date": "2026-11-20",
    }, headers=auth(ngo)).json()["id"]
    client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(volunteer))
    client.post("/messages", json={"sender_email": "vol@example.test", "recipient_email": "org@example.test", "body": "Can I help?"}, headers=auth(volunteer))
    client.post("/messages", json={"sender_email": "org@example.test", "recipient_email": "vol@example.test", "body": "Private reply"}, headers=auth(ngo))
    register_volunteer(client, "someone@example.test", name="Someone Else")

    assert client.post("/account/export", json={"password": "Wrong#Pass1"}, headers=auth(volunteer)).status_code == 400
    assert client.post("/account/export", json={"password": PASSWORD}).status_code == 401

    res = client.post("/account/export", json={"password": PASSWORD}, headers=auth(volunteer))
    assert res.status_code == 200
    assert res.headers["content-disposition"].startswith('attachment; filename="voluntag-volunteer-data-')
    assert res.headers["cache-control"] == "no-store"
    data = res.json()

    assert data["account"]["email"] == "vol@example.test"
    assert data["profile"]["name"] == "Asha"
    assert [s["event_title"] for s in data["event_signups"]] == ["Reading club"]
    assert data["ratings_received"] == {"count": 0, "average": None}
    assert [m["text"] for m in data["messages_sent"]] == ["Can I help?"]

    raw = json.dumps(data)
    for secret in ("pbkdf2_sha256", "password", "token", "vector", "embedding", "Someone Else", "someone@example.test", "Private reply"):
        assert secret not in raw, secret


def test_ratings_received_are_in_the_export(client, volunteer, ngo, freeze_today):
    freeze_today("2026-11-16 10:00")
    eid = client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching", "event_date": "2026-11-20",
    }, headers=auth(ngo)).json()["id"]
    client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(volunteer))
    vid = stored(VolunteerDB, name="Asha").id
    client.post(f"/event-volunteers/{eid}/{vid}/approve", headers=auth(ngo))
    freeze_today("2026-11-21 10:00")
    assert client.post(f"/event-volunteers/{eid}/{vid}/feedback", json={"attendance": "attended", "rating": 4, "feedback": "Great"}, headers=auth(ngo)).status_code == 200

    data = client.post("/account/export", json={"password": PASSWORD}, headers=auth(volunteer)).json()
    assert data["ratings_received"] == {"count": 1, "average": 4.0}
    assert data["event_signups"][0]["rating_received"] == 4
    assert data["event_signups"][0]["feedback_received"] == "Great"


def test_ngo_export_counts_volunteers_without_naming_them(client, volunteer, ngo, freeze_today):
    freeze_today("2026-11-16 10:00")
    eid = client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching", "event_date": "2026-11-20",
    }, headers=auth(ngo)).json()["id"]
    client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(volunteer))

    data = client.post("/account/export", json={"password": PASSWORD}, headers=auth(ngo)).json()
    assert data["profile"]["name"] == "Read Trust"
    assert data["events"][0]["volunteers_signed_up"] == 1
    raw = json.dumps(data)
    for secret in ("vol@example.test", "Asha", "pbkdf2_sha256", "token"):
        assert secret not in raw, secret


def test_export_is_rate_limited(client, volunteer):
    for _ in range(settings.DATA_EXPORT_LIMIT_PER_HOUR):
        assert client.post("/account/export", json={"password": PASSWORD}, headers=auth(volunteer)).status_code == 200
    assert client.post("/account/export", json={"password": PASSWORD}, headers=auth(volunteer)).status_code == 429


# ─── Deactivate ───────────────────────────────────────────────────
def deactivate(client, token, password=PASSWORD, confirm="DEACTIVATE"):
    return client.post("/account/deactivate", json={"password": password, "confirm": confirm}, headers=auth(token))


def test_deactivate_needs_password_and_the_word(client, volunteer):
    assert deactivate(client, volunteer, confirm="deactivate").status_code == 422
    assert deactivate(client, volunteer, confirm="").status_code == 422
    wrong = deactivate(client, volunteer, password="Wrong#Pass1")
    assert wrong.status_code == 400 and wrong.json()["detail"] == "The password you entered is not correct."
    assert stored(VolunteerDB, name="Asha").deactivated_at is None
    assert client.post("/account/deactivate", json={"password": PASSWORD, "confirm": "DEACTIVATE"}).status_code == 401


def test_deactivated_volunteer_cannot_log_in_and_disappears(client, volunteer, ngo, mailbox, freeze_today):
    freeze_today("2026-11-16 10:00")
    other = login(client, "volunteer", "vol@example.test")
    eid = client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching", "event_date": "2026-11-20",
    }, headers=auth(ngo)).json()["id"]
    client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(volunteer))
    before = client.get("/stats").json()["total_volunteers"]
    mailbox.clear()

    res = deactivate(client, volunteer)
    assert res.status_code == 200
    assert client.get("/session", headers=auth(volunteer)).status_code == 401
    assert client.get("/session", headers=auth(other)).status_code == 401

    refused = client.post("/volunteer-login", json={"email": "vol@example.test", "password": PASSWORD})
    assert refused.status_code == 403 and refused.json()["code"] == "account_inactive"
    # A wrong password still gets the ordinary answer.
    assert client.post("/volunteer-login", json={"email": "vol@example.test", "password": "Wrong#Pass1"}).status_code == 401

    assert client.get("/stats").json()["total_volunteers"] == before - 1
    assert client.get("/match").json()["total_volunteers"] == 0

    # Nothing was deleted.
    assert stored(VolunteerDB, name="Asha") is not None
    assert stored(ActivitySignupDB, activity_id=eid) is not None
    assert len(mails_to(mailbox, "vol@example.test")) == 1

    # No reset link for a deactivated account (same answer as always).
    mailbox.clear()
    assert client.post("/forgot-password", json={"role": "volunteer", "email": "vol@example.test"}).status_code == 200
    assert mailbox == []

    # NGOs cannot start new messages to it.
    res = client.post("/messages", json={"sender_email": "org@example.test", "recipient_email": "vol@example.test", "body": "hi"}, headers=auth(ngo))
    assert res.status_code == 400 and res.json()["detail"] == "This account is no longer active"


def test_ngo_with_upcoming_events_must_cancel_them_first(client, ngo, volunteer, freeze_today):
    freeze_today("2026-11-16 10:00")
    event = client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching, tutoring, literacy", "event_date": "2026-11-20",
    }, headers=auth(ngo)).json()

    blocked = deactivate(client, ngo)
    assert blocked.status_code == 409
    body = blocked.json()
    assert body["code"] == "upcoming_events"
    assert [e["title"] for e in body["upcoming_events"]] == ["Reading club"]
    assert "Cancel your 1 upcoming event first" in body["message"]
    assert stored(NGODB, name="Read Trust").deactivated_at is None

    assert client.patch(f"/event-status/{event['id']}", json={"status": "Cancelled"}, headers=auth(ngo)).status_code == 200
    assert deactivate(client, ngo).status_code == 200


def test_completed_events_do_not_block_and_deactivated_ngo_is_hidden(client, ngo, volunteer, freeze_today):
    freeze_today("2026-11-16 10:00")
    client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching, tutoring, literacy", "event_date": "2026-11-20",
    }, headers=auth(ngo))
    assert len(client.get("/volunteer-events/vol@example.test", headers=auth(volunteer)).json()) == 1
    ngos_before = client.get("/stats").json()["total_ngos"]

    freeze_today("2026-11-25 10:00")  # the event is over
    assert deactivate(client, ngo).status_code == 200

    freeze_today("2026-11-16 10:00")  # back before the event: still hidden
    assert client.get("/volunteer-events/vol@example.test", headers=auth(volunteer)).json() == []
    assert client.get("/volunteer-matches/vol@example.test", headers=auth(volunteer)).json()["matches"] == []
    assert "org@example.test" not in [n["email"] for n in client.get("/ngos", headers=auth(volunteer)).json()]
    assert client.get("/stats").json()["total_ngos"] == ngos_before - 1
    event_id = stored(ActivityDB, title="Reading club").id
    joined = client.post(f"/activities/{event_id}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(volunteer))
    assert joined.status_code == 400

    refused = client.post("/ngo-login", json={"email": "org@example.test", "password": PASSWORD})
    assert refused.status_code == 403 and refused.json()["code"] == "account_inactive"


def test_deactivate_is_rate_limited(client, volunteer):
    for _ in range(settings.DEACTIVATE_LIMIT_PER_HOUR):
        assert deactivate(client, volunteer, password="Wrong#Pass1").status_code == 400
    assert deactivate(client, volunteer).status_code == 429


# ─── Admin ────────────────────────────────────────────────────────
def test_admin_sees_and_reactivates(client, volunteer, ngo):
    vid = stored(VolunteerDB, name="Asha").id
    nid = stored(NGODB, name="Read Trust").id
    deactivate(client, volunteer)
    deactivate(client, ngo)
    admin = auth(admin_token())

    vols = {v["id"]: v for v in client.get("/admin/volunteers", headers=admin).json()}
    ngos = {n["id"]: n for n in client.get("/admin/ngos", headers=admin).json()}
    assert vols[vid]["deactivated_at"] and ngos[nid]["deactivated_at"]
    assert client.get(f"/admin/volunteers/{vid}", headers=admin).json()["profile"]["deactivated_at"]
    assert client.get(f"/admin/ngos/{nid}", headers=admin).json()["profile"]["deactivated_at"]

    # Admin session only.
    assert client.post(f"/admin/volunteers/{vid}/reactivate").status_code == 401
    assert client.post(f"/admin/volunteers/{vid}/reactivate", headers=auth("not-an-admin-token")).status_code == 401

    res = client.post(f"/admin/volunteers/{vid}/reactivate", headers=admin)
    assert res.status_code == 200 and res.json()["deactivated_at"] is None
    assert client.post(f"/admin/volunteers/{vid}/reactivate", headers=admin).status_code == 409
    assert client.post(f"/admin/ngos/{nid}/reactivate", headers=admin).status_code == 200
    assert client.post("/admin/ngos/99999/reactivate", headers=admin).status_code == 404

    login(client, "volunteer", "vol@example.test")
    login(client, "ngo", "org@example.test")

    db = db_session()
    try:
        actions = {(a.action, a.target_type, a.target_id) for a in db.query(AdminActionDB).all()}
    finally:
        db.close()
    assert ("reactivate_volunteer", "volunteer", str(vid)) in actions
    assert ("reactivate_ngo", "ngo", str(nid)) in actions


def test_existing_accounts_are_active(client, volunteer):
    """deactivated_at defaults to NULL, so nothing changes for existing rows."""
    assert stored(VolunteerDB, name="Asha").deactivated_at is None
    assert stored(UserSessionDB, user_role="volunteer") is not None
