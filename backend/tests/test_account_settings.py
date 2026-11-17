"""Settings, part 1: profile edits, change password, sessions."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

import database
import migrations
import settings
import user_auth
from conftest import PASSWORD, auth, db_session, login, mails_to, register_ngo, register_volunteer
from db_models import EmbeddingDB, NGODB, UserSessionDB, VolunteerDB
from embedding_store import text_hash

NEW_PASSWORD = "Fresh-Pass#9182"
CHROME_MAC = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"


def row(model, email):
    db = db_session()
    try:
        found = db.query(model).filter(model.email == email).one()
        db.expunge(found)
        return found
    finally:
        db.close()


def vector_hash(owner_type, owner_id):
    db = db_session()
    try:
        found = db.query(EmbeddingDB).filter_by(owner_type=owner_type, owner_id=owner_id).first()
        return found.text_hash if found else None
    finally:
        db.close()


@pytest.fixture
def volunteer(client):
    register_volunteer(client, "vol@example.test", name="Asha", skills="Cooking, driving")
    return login(client, "volunteer", "vol@example.test")


@pytest.fixture
def ngo(client):
    register_ngo(client, "org@example.test", name="Read Trust", category="Education", motto="Teaching children to read")
    return login(client, "ngo", "org@example.test")


# ─── Volunteer profile ────────────────────────────────────────────
def test_volunteer_profile_needs_the_owners_session(client, volunteer, ngo):
    assert client.get("/volunteer/me").status_code == 401
    assert client.patch("/volunteer/me", json={"location": "Goa"}).status_code == 401
    assert client.get("/volunteer/me", headers=auth("not-a-token")).status_code == 401
    # An NGO session is not a volunteer session.
    assert client.get("/volunteer/me", headers=auth(ngo)).status_code == 403
    assert client.patch("/volunteer/me", json={"location": "Goa"}, headers=auth(ngo)).status_code == 403

    me = client.get("/volunteer/me", headers=auth(volunteer))
    assert me.status_code == 200
    assert me.json()["email"] == "vol@example.test"
    assert me.json()["cause_interests"] == []
    assert "password" not in me.json()


def test_only_allow_listed_fields_change(client, volunteer):
    before = row(VolunteerDB, "vol@example.test")
    for extra in (
        {"email": "other@example.test"}, {"password": "Another#Pass1"}, {"id": 99},
        {"email_verified": 0}, {"deactivated_at": "2026-01-01T00:00:00"}, {"rating": 5},
    ):
        res = client.patch("/volunteer/me", json={"location": "Goa", **extra}, headers=auth(volunteer))
        assert res.status_code == 422, extra
        assert res.json()["detail"][0]["type"] == "extra_forbidden"

    after = row(VolunteerDB, "vol@example.test")
    assert (after.email, after.password, after.location) == (before.email, before.password, before.location)


def test_partial_update_trims_and_keeps_other_fields(client, volunteer):
    res = client.patch("/volunteer/me", json={
        "location": "  Goa, India ", "bio": "  I like to help.  ",
        "cause_interests": ["Health", "Education", "Health"], "availability": "Weekdays",
    }, headers=auth(volunteer))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["location"] == "Goa, India"
    assert body["bio"] == "I like to help."
    assert body["cause_interests"] == ["Health", "Education"]
    assert body["skills"] == "Cooking, driving"  # not sent, not changed
    assert body["name"] == "Asha"

    stored = row(VolunteerDB, "vol@example.test")
    assert stored.cause_interests == "Health, Education"

    # Clearing the optional fields.
    res = client.patch("/volunteer/me", json={"bio": "", "cause_interests": []}, headers=auth(volunteer))
    assert res.json()["bio"] is None and res.json()["cause_interests"] == []

    # The dashboard shows the new values too.
    dash = client.get("/volunteer-dashboard/vol@example.test", headers=auth(volunteer)).json()
    assert dash["location"] == "Goa, India" and dash["availability"] == "Weekdays"


@pytest.mark.parametrize("field, value", [
    ("age", 0), ("age", 121), ("name", "x" * 101), ("name", ""), ("skills", ""),
    ("location", ""), ("availability", ""), ("designation", ""), ("gender", ""), ("contact_number", ""),
])
def test_same_rules_as_registration(client, volunteer, field, value):
    """The field rules come from one place, so registration rejects the same values."""
    res = client.patch("/volunteer/me", json={field: value}, headers=auth(volunteer))
    assert res.status_code == 422, (field, value)

    body = {
        "name": "Reg", "email": "reg@example.test", "contact_number": "1", "password": PASSWORD,
        "age": 30, "designation": "S", "gender": "F", "skills": "x", "location": "y",
        "availability": "z", field: value,
    }
    assert client.post("/add-volunteer", json=body).status_code == 422, (field, value)


def test_update_rejects_blank_null_and_unknown_causes(client, volunteer):
    for body in (
        {"skills": "   "}, {"skills": " , , "}, {"skills": None}, {"name": None}, {"age": None},
        {"cause_interests": ["Space travel"]}, {"cause_interests": ["Health"] * 6},
        {"bio": "x" * 1001},
    ):
        assert client.patch("/volunteer/me", json=body, headers=auth(volunteer)).status_code == 422, body


def test_name_must_stay_unique(client, volunteer):
    register_volunteer(client, "other@example.test", name="Bina")
    res = client.patch("/volunteer/me", json={"name": "bina"}, headers=auth(volunteer))
    assert res.status_code == 400
    assert "already exists" in res.json()["detail"]
    # Changing only the case of one's own name is fine.
    assert client.patch("/volunteer/me", json={"name": "ASHA"}, headers=auth(volunteer)).status_code == 200


def test_skills_change_re_encodes_and_changes_event_list(client, volunteer, ngo, freeze_today):
    freeze_today("2026-11-16 10:00")
    event = client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching, tutoring, literacy",
        "location": "Pune", "event_date": "2026-11-20", "spots_available": 3,
    }, headers=auth(ngo))
    assert event.status_code == 201, event.text

    assert client.get("/volunteer-events/vol@example.test", headers=auth(volunteer)).json() == []
    vid = row(VolunteerDB, "vol@example.test").id

    res = client.patch("/volunteer/me", json={"skills": "Teaching, tutoring, literacy"}, headers=auth(volunteer))
    assert res.status_code == 200
    # Re-encoded at once, before any matching request.
    assert vector_hash("volunteer_skills", vid) == text_hash("Teaching, tutoring, literacy")

    listed = client.get("/volunteer-events/vol@example.test", headers=auth(volunteer)).json()
    assert [e["activity_id"] for e in listed] == [event.json()["id"]]


def test_a_failed_re_encode_does_not_fail_the_save(client, volunteer, monkeypatch):
    import embedding_store

    def broken(texts):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(embedding_store, "encode_texts", broken)
    res = client.patch("/volunteer/me", json={"skills": "Nursing"}, headers=auth(volunteer))
    assert res.status_code == 200
    assert row(VolunteerDB, "vol@example.test").skills == "Nursing"


# ─── NGO profile ──────────────────────────────────────────────────
def test_ngo_profile_needs_the_owners_session(client, volunteer, ngo):
    assert client.get("/ngo/me").status_code == 401
    assert client.get("/ngo/me", headers=auth(volunteer)).status_code == 403
    assert client.patch("/ngo/me", json={"location": "Goa"}, headers=auth(volunteer)).status_code == 403
    me = client.get("/ngo/me", headers=auth(ngo)).json()
    assert me["name"] == "Read Trust" and me["documents"] == []
    assert me["verification_status"] == "Pending"


def test_ngo_name_documents_and_status_cannot_change(client, ngo):
    before = row(NGODB, "org@example.test")
    for extra in (
        {"name": "New Name"}, {"email": "x@example.test"}, {"verification_status": "Approved"},
        {"registration_certificate": "x.pdf"}, {"legal_structure": "Society"}, {"year_founded": 1990},
        {"work_images": []}, {"password": "Another#Pass1"}, {"verified_at": None},
    ):
        res = client.patch("/ngo/me", json={"location": "Goa", **extra}, headers=auth(ngo))
        assert res.status_code == 422, extra

    after = row(NGODB, "org@example.test")
    assert (after.name, after.verification_status, after.location) == (before.name, before.verification_status, before.location)


def test_ngo_edit_keeps_approval_and_re_encodes_mission(client, ngo):
    db = db_session()
    try:
        db.query(NGODB).filter(NGODB.email == "org@example.test").update({"verification_status": "Approved"})
        db.commit()
    finally:
        db.close()
    nid = row(NGODB, "org@example.test").id

    res = client.patch("/ngo/me", json={
        "motto": "  Libraries for every village ", "address": "12 MG Road, Pune",
        "contact_number": "020 1234", "website_url": "readtrust.example.org", "category": "Health",
        "location": "Mumbai",
    }, headers=auth(ngo))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["motto"] == "Libraries for every village"
    assert body["website_url"] == "https://readtrust.example.org"
    assert body["category"] == "Health" and body["address"] == "12 MG Road, Pune"
    assert body["verification_status"] == "Approved"
    assert vector_hash("ngo_motto", nid) == text_hash("Libraries for every village")
    assert vector_hash("ngo_motto_raw", nid) == text_hash("Libraries for every village")

    res = client.patch("/ngo/me", json={"website_url": "", "address": ""}, headers=auth(ngo))
    assert res.json()["website_url"] is None and res.json()["address"] is None


@pytest.mark.parametrize("url", [
    "javascript:alert(1)", "ftp://files.example.org", "https://localhost", "data:text/html,hi",
    "//evil.example.org", "https://exa mple.org", "https://user@evil.example.org", "http://<x>.org",
    "https://" + "a" * 300 + ".org",
])
def test_ngo_website_must_be_http(client, ngo, url):
    res = client.patch("/ngo/me", json={"website_url": url}, headers=auth(ngo))
    assert res.status_code == 422, url


def test_ngo_required_fields_and_category(client, ngo):
    for body in (
        {"motto": ""}, {"motto": "   "}, {"location": ""}, {"contact_number": ""}, {"category": "Space"},
        {"category": None}, {"motto": None}, {"motto": "x" * 1001},
    ):
        assert client.patch("/ngo/me", json=body, headers=auth(ngo)).status_code == 422, body


def test_category_change_changes_who_sees_the_events(client, volunteer, ngo, freeze_today):
    """Category is read when scoring, so a change shows up on the next request."""
    freeze_today("2026-11-16 10:00")
    client.patch("/volunteer/me", json={"skills": "Teaching, tutoring, literacy"}, headers=auth(volunteer))
    client.post("/organize-event/org@example.test", json={
        "title": "Reading club", "required_skills": "Teaching, tutoring, literacy",
        "location": "Pune", "event_date": "2026-11-20",
    }, headers=auth(ngo))
    assert len(client.get("/volunteer-events/vol@example.test", headers=auth(volunteer)).json()) == 1

    assert client.patch("/ngo/me", json={"category": "Animal Welfare"}, headers=auth(ngo)).status_code == 200
    assert client.get("/volunteer-events/vol@example.test", headers=auth(volunteer)).json() == []


# ─── Change password ──────────────────────────────────────────────
def change(client, token, current=PASSWORD, new=NEW_PASSWORD):
    return client.post("/account/password", json={"current_password": current, "new_password": new}, headers=auth(token))


def test_change_password_keeps_this_session_and_ends_the_others(client, volunteer, mailbox):
    other = login(client, "volunteer", "vol@example.test")
    res = change(client, volunteer)
    assert res.status_code == 200, res.text
    assert res.json()["sessions_revoked"] == 1

    assert client.get("/session", headers=auth(volunteer)).status_code == 200
    assert client.get("/session", headers=auth(other)).status_code == 401

    bad = client.post("/volunteer-login", json={"email": "vol@example.test", "password": PASSWORD})
    assert bad.status_code == 401
    login(client, "volunteer", "vol@example.test", NEW_PASSWORD)

    notices = mails_to(mailbox, "vol@example.test")
    assert len(notices) == 1 and notices[0]["Subject"] == "Your VolunTag password was changed"


def test_change_password_errors(client, volunteer):
    wrong = change(client, volunteer, current="Wrong#Pass123")
    assert wrong.status_code == 400
    assert wrong.json()["detail"] == "The password you entered is not correct."
    assert change(client, volunteer, current="").json()["detail"] == wrong.json()["detail"]

    weak = change(client, volunteer, new="short")
    assert weak.status_code == 422 and weak.json()["detail"].startswith("Password must have")

    same = change(client, volunteer, new=PASSWORD)
    assert same.status_code == 422 and "different" in same.json()["detail"]

    # Nothing changed.
    login(client, "volunteer", "vol@example.test")


def test_change_password_is_rate_limited(client, volunteer):
    for _ in range(settings.CHANGE_PASSWORD_LIMIT_PER_HOUR):
        assert change(client, volunteer, current="Wrong#Pass123").status_code == 400
    limited = change(client, volunteer)  # even the right password waits now
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0


def test_ngo_can_change_password_too(client, ngo):
    assert change(client, ngo).status_code == 200
    login(client, "ngo", "org@example.test", NEW_PASSWORD)


def test_change_password_needs_login(client):
    assert client.post("/account/password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}).status_code == 401


# ─── Sessions ─────────────────────────────────────────────────────
def login_with_agent(client, agent):
    res = client.post("/volunteer-login", json={"email": "vol@example.test", "password": PASSWORD}, headers={"User-Agent": agent})
    assert res.status_code == 200
    return res.json()["token"]


def test_sessions_list_marks_the_current_one(client, volunteer):
    mine = login_with_agent(client, CHROME_MAC)
    login_with_agent(client, FIREFOX_WIN)

    res = client.get("/account/sessions", headers=auth(mine))
    assert res.status_code == 200
    entries = res.json()
    assert len(entries) == 3
    assert entries[0]["current"] is True and entries[0]["device"] == "Chrome on macOS"
    assert [e["current"] for e in entries].count(True) == 1
    assert "Firefox on Windows" in [e["device"] for e in entries]
    assert all(e["created_at"].endswith("Z") for e in entries)
    assert all("token" not in e and "token_hash" not in e for e in entries)


def test_logout_other_sessions(client, volunteer, ngo):
    other = login(client, "volunteer", "vol@example.test")
    res = client.post("/account/sessions/logout-others", headers=auth(volunteer))
    assert res.status_code == 200 and res.json() == {"revoked": 1}
    assert client.get("/session", headers=auth(other)).status_code == 401
    assert client.get("/session", headers=auth(volunteer)).status_code == 200
    # Another account's sessions are untouched.
    assert client.get("/session", headers=auth(ngo)).status_code == 200
    assert len(client.get("/account/sessions", headers=auth(volunteer)).json()) == 1


def test_sessions_need_login(client):
    assert client.get("/account/sessions").status_code == 401
    assert client.post("/account/sessions/logout-others").status_code == 401


@pytest.mark.parametrize("agent, label", [
    (CHROME_MAC, "Chrome on macOS"),
    (FIREFOX_WIN, "Firefox on Windows"),
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", "Safari on iPhone"),
    ("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 EdgA/130.0", "Edge on Android"),
    ("curl/8.0", "Unknown device"),
    ("", None),
])
def test_device_label(agent, label):
    assert user_auth.device_label(agent) == label


def test_last_used_is_written_at_most_once_a_minute(client, volunteer, monkeypatch):
    def last_used():
        db = db_session()
        try:
            return db.query(UserSessionDB.last_used_at).filter(UserSessionDB.token_hash == user_auth.hash_token(volunteer)).scalar()
        finally:
            db.close()

    first = last_used()
    client.get("/session", headers=auth(volunteer))
    assert last_used() == first  # within the minute: no write

    db = db_session()
    try:
        db.query(UserSessionDB).update({"last_used_at": datetime.utcnow() - timedelta(minutes=2)})
        db.commit()
    finally:
        db.close()
    old = last_used()
    client.get("/session", headers=auth(volunteer))
    assert last_used() > old


# ─── Migrations ───────────────────────────────────────────────────
LEGACY = {
    "volunteers": (
        "CREATE TABLE volunteers (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL UNIQUE, "
        "email VARCHAR NOT NULL UNIQUE, contact_number VARCHAR NOT NULL, password VARCHAR, "
        "age INTEGER NOT NULL, designation VARCHAR NOT NULL, gender VARCHAR NOT NULL, "
        "skills VARCHAR, location VARCHAR, availability VARCHAR, experience VARCHAR, "
        "email_verified INTEGER NOT NULL DEFAULT 1)"
    ),
    "ngos": (
        "CREATE TABLE ngos (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL UNIQUE, category VARCHAR, "
        "location VARCHAR, email VARCHAR UNIQUE, contact_number VARCHAR, password VARCHAR, "
        "year_founded INTEGER, website_url VARCHAR, motto VARCHAR, legal_structure VARCHAR, "
        "verification_status VARCHAR(20) NOT NULL, verification_notes TEXT, verified_at DATETIME, "
        "email_verified INTEGER NOT NULL DEFAULT 1)"
    ),
    "user_sessions": (
        "CREATE TABLE user_sessions (id INTEGER PRIMARY KEY, token_hash VARCHAR(64) NOT NULL UNIQUE, "
        "user_role VARCHAR(16) NOT NULL, user_id INTEGER NOT NULL, email VARCHAR NOT NULL, "
        "created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, last_used_at DATETIME)"
    ),
}


def table_state(table):
    with database.engine.connect() as c:
        cols = [r[1] for r in c.execute(text(f"PRAGMA table_info({table})"))]
        rows = [tuple(r) for r in c.execute(text(f"SELECT * FROM {table} ORDER BY id"))]
    return cols, rows


def test_settings_migration_is_additive_and_idempotent():
    with database.engine.begin() as c:
        for table, ddl in LEGACY.items():
            c.execute(text(f"DROP TABLE IF EXISTS {table}"))
            c.execute(text(ddl))
        c.execute(text("INSERT INTO volunteers (name, email, contact_number, age, designation, gender, skills) VALUES ('old', 'old@example.test', '1', 20, 'S', 'F', 'x')"))
        c.execute(text("INSERT INTO ngos (name, email, verification_status, category) VALUES ('Old NGO', 'ngo@example.test', 'Approved', 'Health')"))
        c.execute(text("INSERT INTO user_sessions (token_hash, user_role, user_id, email, created_at, expires_at) VALUES ('h', 'ngo', 1, 'ngo@example.test', '2026-01-01', '2099-01-01')"))
        c.execute(text("DROP TABLE IF EXISTS email_change_tokens"))
    database.Base.metadata.create_all(bind=database.engine)

    before = {table: table_state(table) for table in LEGACY}
    result = migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert result["backup"] is None

    for table, extra in migrations.SETTINGS_COLUMNS.items():
        cols, rows = table_state(table)
        old_cols, old_rows = before[table]
        assert cols == old_cols + list(extra)
        # Old values unchanged, new columns NULL (so every account stays active).
        assert [r[:len(old_cols)] for r in rows] == old_rows
        assert all(value is None for r in rows for value in r[len(old_cols):])

    with database.engine.connect() as c:
        tables = {r[0] for r in c.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
    assert "email_change_tokens" in tables

    after = {table: table_state(table) for table in LEGACY}
    again = migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert again["backup"] is None
    assert migrations.ensure_settings_columns(database.engine) == {t: [] for t in migrations.SETTINGS_COLUMNS}
    assert {table: table_state(table) for table in LEGACY} == after
