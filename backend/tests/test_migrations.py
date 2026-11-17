"""Startup migrations: additive, idempotent, backup before rewriting rows."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import database
import migrations
import settings
from conftest import TEST_DATA_DIR

INSERT = (
    "INSERT INTO volunteers (name, email, contact_number, age, designation, gender) "
    "VALUES (:n, :e, '1', 20, 'S', 'F')"
)


def fresh():
    database.Base.metadata.create_all(bind=database.engine)


def backups():
    return sorted(TEST_DATA_DIR.glob("voluntag.db.bak-before-email-normalise-*"))


def test_lowercases_with_backup_and_is_idempotent():
    fresh()
    with database.engine.begin() as c:
        c.execute(text(INSERT), {"n": "a", "e": " Mixed@Example.TEST "})
        c.execute(text(INSERT), {"n": "b", "e": "lower@example.test"})

    result = migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert result["tables"]["volunteers"] == {"status": "ok", "collisions": [], "updated": 1}
    assert result["backup"] and len(backups()) == 1

    with database.engine.connect() as c:
        emails = sorted(r[0] for r in c.execute(text("select email from volunteers")))
    assert emails == ["lower@example.test", "mixed@example.test"]

    again = migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert again["backup"] is None and again["tables"]["volunteers"]["updated"] == 0
    assert len(backups()) == 1

    # The unique index now refuses a case variant.
    with pytest.raises(IntegrityError):
        with database.engine.begin() as c:
            c.execute(text(INSERT), {"n": "c", "e": "LOWER@example.test"})


def test_collisions_are_skipped_and_reported():
    fresh()
    with database.engine.begin() as c:
        c.execute(text(INSERT), {"n": "a", "e": "Same@example.test"})
        c.execute(text(INSERT), {"n": "b", "e": "same@example.test"})

    result = migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert result["tables"]["volunteers"]["status"] == "skipped_collisions"
    assert result["tables"]["volunteers"]["collisions"] == ["same@example.test"]
    assert result["backup"] is None and backups() == []
    with database.engine.connect() as c:
        assert sorted(r[0] for r in c.execute(text("select email from volunteers"))) == ["Same@example.test", "same@example.test"]
        names = {r[1] for r in c.execute(text("PRAGMA index_list(volunteers)"))}
    assert "ux_volunteers_email_lower" not in names


def test_indexes_and_pragmas():
    fresh()
    migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    with database.engine.connect() as c:
        names = {r[0] for r in c.execute(text("select name from sqlite_master where type='index'"))}
        assert {"ix_activities_status_event_date", "ix_activity_signups_volunteer_id", "ix_user_sessions_role_user"} <= names
        assert c.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert c.execute(text("PRAGMA journal_mode")).scalar() == "wal"


LEGACY_VOLUNTEERS = (
    "CREATE TABLE volunteers (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL UNIQUE, "
    "email VARCHAR NOT NULL UNIQUE, contact_number VARCHAR NOT NULL, password VARCHAR, "
    "age INTEGER NOT NULL, designation VARCHAR NOT NULL, gender VARCHAR NOT NULL, "
    "skills VARCHAR, location VARCHAR, availability VARCHAR, experience VARCHAR)"
)


def dump(table):
    with database.engine.connect() as c:
        return [tuple(r) for r in c.execute(text(f"SELECT * FROM {table} ORDER BY id"))]


def columns(table):
    with database.engine.connect() as c:
        return [r[1] for r in c.execute(text(f"PRAGMA table_info({table})"))]


def test_existing_accounts_become_verified_without_rewriting_rows():
    """An old database (no email_verified column): every existing account counts as verified."""
    with database.engine.begin() as c:
        c.execute(text("DROP TABLE IF EXISTS volunteers"))
        c.execute(text(LEGACY_VOLUNTEERS))
        c.execute(text(INSERT), {"n": "old", "e": "old@example.test"})
    fresh()  # creates every other table; volunteers keeps its legacy shape
    assert "email_verified" not in columns("volunteers")

    result = migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert result["backup"] is None  # nothing had to be rewritten
    assert "email_verified" in columns("volunteers")
    assert "email_verified" in columns("ngos")

    with database.engine.connect() as c:
        assert c.execute(text("SELECT email_verified FROM volunteers")).scalar() == 1
        tables = {r[0] for r in c.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
    assert "email_verification_tokens" in tables

    before = (columns("volunteers"), dump("volunteers"), columns("ngos"))
    again = migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    assert again["backup"] is None
    assert (columns("volunteers"), dump("volunteers"), columns("ngos")) == before
    assert backups() == []


def test_new_rows_from_the_app_default_to_unverified():
    fresh()
    migrations.run_migrations(database.engine, settings.DATABASE_PATH)
    from db_models import VolunteerDB
    db = database.SessionLocal()
    try:
        row = VolunteerDB(name="n", email="n@example.test", contact_number="1", age=1, designation="d", gender="g")
        db.add(row)
        db.commit()
        assert row.email_verified == 0
    finally:
        db.close()
