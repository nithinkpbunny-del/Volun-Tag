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
