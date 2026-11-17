"""Admin console: contact messages (list, filters, search, paging, read/archive, audit)."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

import database
import migrations
import settings
from conftest import admin_token, auth, db_session
from db_models import AdminActionDB, ContactMessageDB

BASE = datetime(2026, 11, 1, 9, 0)


def add(name="Asha", email="asha@example.test", subject=None, message="Hello there, a question.", minutes=0, **extra):
    db = db_session()
    try:
        row = ContactMessageDB(
            name=name, email=email, subject=subject, message=message,
            content_hash=f"{name}-{minutes}-{message}"[:64],
            created_at=BASE + timedelta(minutes=minutes), **extra,
        )
        db.add(row)
        db.commit()
        return row.id
    finally:
        db.close()


@pytest.fixture
def admin(client):
    return auth(admin_token())


def ids(res):
    assert res.status_code == 200, res.text
    return [item["id"] for item in res.json()["items"]]


# ─── Access ───────────────────────────────────────────────────────
@pytest.mark.parametrize("method,path", [
    ("get", "/admin/contact-messages"),
    ("get", "/admin/contact-messages/unread-count"),
    ("get", "/admin/contact-messages/1"),
    ("post", "/admin/contact-messages/1/read"),
    ("post", "/admin/contact-messages/1/unread"),
    ("post", "/admin/contact-messages/1/archive"),
    ("post", "/admin/contact-messages/1/unarchive"),
])
def test_requires_admin_session(client, method, path):
    add()
    assert getattr(client, method)(path).status_code == 401
    assert getattr(client, method)(path, headers=auth("not-a-token")).status_code == 401


def test_user_session_is_not_admin(client):
    from conftest import login, register_volunteer
    register_volunteer(client)
    token = login(client, "volunteer", "vol@example.test")
    assert client.get("/admin/contact-messages", headers=auth(token)).status_code == 401


# ─── List, filters, search, paging ────────────────────────────────
def test_default_lists_inbox_newest_first_with_unread_count(client, admin):
    old = add(name="Old", minutes=0)
    new = add(name="New", minutes=10)
    read = add(name="Read", minutes=5, read_at=BASE)
    add(name="Gone", minutes=20, archived_at=BASE)

    res = client.get("/admin/contact-messages", headers=admin)
    assert ids(res) == [new, read, old]
    body = res.json()
    assert body["total"] == 3 and body["unread_count"] == 2
    assert body["page"] == 1 and body["page_size"] == 20
    first = body["items"][0]
    assert first["is_read"] is False and first["is_archived"] is False
    assert "message" not in first and first["preview"] == "Hello there, a question."


def test_status_filters(client, admin):
    unread = add(name="Unread", minutes=1)
    read = add(name="Read", minutes=2, read_at=BASE)
    legacy = add(name="Legacy", minutes=3, status="replied")  # old row, no read_at
    archived = add(name="Archived", minutes=4, archived_at=BASE)

    get = lambda s: ids(client.get(f"/admin/contact-messages?status={s}", headers=admin))
    assert get("unread") == [unread]
    assert get("read") == [legacy, read]
    assert get("archived") == [archived]
    assert get("all") == [archived, legacy, read, unread]
    assert client.get("/admin/contact-messages?status=bogus", headers=admin).status_code == 422


def test_search_covers_name_email_subject_message(client, admin):
    a = add(name="Ravi Kumar", email="ravi@example.test", minutes=1)
    b = add(name="B", email="partner@ngo.example.test", minutes=2)
    c = add(name="C", subject="Broken login page", minutes=3)
    d = add(name="D", message="I found a pothole near the school.", minutes=4)
    add(name="E", message="Nothing relevant here at all.", minutes=5)

    q = lambda t: ids(client.get("/admin/contact-messages", params={"q": t}, headers=admin))
    assert q("ravi") == [a]
    assert q("NGO.EXAMPLE") == [b]
    assert q("login") == [c]
    assert q("pothole") == [d]
    assert q("100%") == []  # wildcards are literal
    assert q("  ") == ids(client.get("/admin/contact-messages", headers=admin))


def test_pagination(client, admin):
    made = [add(name=f"P{i}", minutes=i) for i in range(5)]
    newest_first = list(reversed(made))

    page1 = client.get("/admin/contact-messages?page=1&page_size=2", headers=admin)
    page3 = client.get("/admin/contact-messages?page=3&page_size=2", headers=admin)
    page9 = client.get("/admin/contact-messages?page=9&page_size=2", headers=admin)
    assert ids(page1) == newest_first[:2] and page1.json()["total"] == 5
    assert ids(page3) == newest_first[4:]
    assert ids(page9) == [] and page9.json()["total"] == 5
    assert client.get("/admin/contact-messages?page_size=101", headers=admin).status_code == 422
    assert client.get("/admin/contact-messages?page=0", headers=admin).status_code == 422


# ─── One message, state changes, audit ────────────────────────────
def test_get_one_returns_full_text_and_does_not_mark_read(client, admin):
    long_text = "Line one\nLine two\n\n" + "x" * 1900
    mid = add(message=long_text)
    res = client.get(f"/admin/contact-messages/{mid}", headers=admin)
    assert res.status_code == 200
    assert res.json()["message"] == long_text and res.json()["is_read"] is False
    assert client.get("/admin/contact-messages/999", headers=admin).status_code == 404


def test_read_unread_archive_unarchive_with_audit(client, admin):
    mid = add(subject="Hi")
    other = add(name="Other", minutes=1)

    res = client.post(f"/admin/contact-messages/{mid}/read", headers=admin).json()
    assert res["is_read"] and res["read_at"] and res["changed"] and res["unread_count"] == 1
    again = client.post(f"/admin/contact-messages/{mid}/read", headers=admin).json()
    assert again["changed"] is False  # idempotent, not logged twice

    res = client.post(f"/admin/contact-messages/{mid}/unread", headers=admin).json()
    assert res["is_read"] is False and res["read_at"] is None and res["unread_count"] == 2

    res = client.post(f"/admin/contact-messages/{mid}/archive", headers=admin).json()
    assert res["is_archived"] and res["unread_count"] == 1
    inbox = ids(client.get("/admin/contact-messages", headers=admin))
    assert inbox == [other]
    assert client.get("/admin/contact-messages/unread-count", headers=admin).json() == {"unread_count": 1}

    res = client.post(f"/admin/contact-messages/{mid}/unarchive", headers=admin).json()
    assert res["is_archived"] is False
    assert mid in ids(client.get("/admin/contact-messages", headers=admin))

    db = db_session()
    try:
        log = db.query(AdminActionDB).filter(AdminActionDB.target_type == "contact_message").order_by(AdminActionDB.id).all()
        assert [e.action for e in log] == [
            "contact_mark_read", "contact_mark_unread", "contact_archive", "contact_unarchive",
        ]
        assert all(e.target_id == str(mid) for e in log)
        assert db.query(ContactMessageDB).count() == 2  # nothing deleted
    finally:
        db.close()

    assert client.post("/admin/contact-messages/999/archive", headers=admin).status_code == 404


def test_no_delete_endpoint(client, admin):
    mid = add()
    assert client.delete(f"/admin/contact-messages/{mid}", headers=admin).status_code == 405


def test_marking_legacy_replied_row_unread(client, admin):
    mid = add(status="replied")
    res = client.post(f"/admin/contact-messages/{mid}/unread", headers=admin).json()
    assert res["is_read"] is False and res["unread_count"] == 1


# ─── Plain text ───────────────────────────────────────────────────
def test_message_text_is_stored_and_returned_verbatim(client, admin):
    nasty = '<script>alert("x")</script>\n<b>bold</b> & <img src=x onerror=alert(1)>\nbye now'
    res = client.post("/contact", json={
        "name": "<i>Eve</i>", "email": "eve@example.test",
        "subject": "<h1>Hi</h1>", "message": nasty,
    })
    assert res.status_code == 201
    [item] = client.get("/admin/contact-messages", headers=admin).json()["items"]
    one = client.get(f"/admin/contact-messages/{item['id']}", headers=admin)
    assert one.headers["content-type"].startswith("application/json")
    assert one.json()["message"] == nasty  # not escaped, not stripped: the UI renders it as text
    assert one.json()["name"] == "<i>Eve</i>" and one.json()["subject"] == "<h1>Hi</h1>"
    assert "\n" not in item["preview"]


def test_submitted_message_appears_unread(client, admin, mailbox):
    client.post("/contact", json={"name": "Asha", "email": "a@example.test", "message": "Please call me back soon."})
    body = client.get("/admin/contact-messages", headers=admin).json()
    assert body["unread_count"] == 1 and body["items"][0]["is_read"] is False
    assert mailbox == []  # CONTACT_SEND_EMAIL is off by default


# ─── Migration ────────────────────────────────────────────────────
OLD_TABLE = """
CREATE TABLE contact_messages (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL, subject VARCHAR(150),
    message TEXT NOT NULL, role VARCHAR(20), ip_hash VARCHAR(64),
    content_hash VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
    mail_sent INTEGER NOT NULL, created_at DATETIME NOT NULL, handled_at DATETIME
)"""


def table_state():
    with database.engine.connect() as c:
        cols = [tuple(r) for r in c.execute(text("PRAGMA table_info(contact_messages)"))]
        rows = [tuple(r) for r in c.execute(text(
            "SELECT id, name, email, subject, message, role, ip_hash, content_hash, "
            "status, mail_sent, created_at, handled_at FROM contact_messages ORDER BY id"
        ))]
    return cols, rows


def test_migration_adds_columns_without_touching_rows_and_is_idempotent():
    database.Base.metadata.create_all(bind=database.engine)
    with database.engine.begin() as c:
        c.execute(text("DROP TABLE contact_messages"))
        c.execute(text(OLD_TABLE))
        c.execute(text(
            "INSERT INTO contact_messages (name, email, subject, message, role, ip_hash, content_hash, "
            "status, mail_sent, created_at) VALUES ('Old', 'old@example.test', NULL, 'Kept as is, line\nbreak', "
            "NULL, 'h', 'c', 'replied', 1, '2026-11-01 10:00:00')"
        ))
    _, rows_before = table_state()

    migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    cols, rows_after = table_state()
    names = [c[1] for c in cols]
    assert names[-2:] == ["read_at", "archived_at"]
    assert rows_after == rows_before
    with database.engine.connect() as c:
        assert c.execute(text("SELECT read_at, archived_at FROM contact_messages")).one() == (None, None)

    assert migrations.ensure_contact_columns(database.engine) == []
    migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert table_state() == (cols, rows_after)
    assert not list(settings.DATA_DIR.glob("voluntag.db.bak-*"))  # no row rewrite, no backup


def test_migration_skips_missing_table():
    database.Base.metadata.drop_all(bind=database.engine)
    assert migrations.ensure_contact_columns(database.engine) == []
