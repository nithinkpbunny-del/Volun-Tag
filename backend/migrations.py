"""Startup migrations. Every step is additive and idempotent: running it again
changes nothing. A step that rewrites existing rows first copies the database
file to a timestamped backup next to it.
"""

import logging
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import text


logger = logging.getLogger(__name__)

SIGNUP_COLUMNS = {
    "approved_at": "DATETIME",
    "attended_at": "DATETIME",
    "feedback": "TEXT",
    "rating": "INTEGER",
    "attendance_status": "VARCHAR(20)",
}

# Admin console state for contact-form messages (both nullable, no backfill).
CONTACT_COLUMNS = {
    "read_at": "DATETIME",
    "archived_at": "DATETIME",
}

# Email verification (email_verification.py). DEFAULT 1 marks every account
# that already exists as verified; SQLite adds a column with a constant
# default without rewriting any row, so no backup is needed.
ACCOUNT_COLUMNS = {
    "email_verified": "INTEGER NOT NULL DEFAULT 1",
}

# Account settings (account_settings.py). All nullable without a default, so
# adding them rewrites no row and every existing account stays active
# (deactivated_at IS NULL).
SETTINGS_COLUMNS = {
    "volunteers": {
        "bio": "TEXT",
        "cause_interests": "VARCHAR",
        "deactivated_at": "DATETIME",
    },
    "ngos": {
        "address": "TEXT",
        "deactivated_at": "DATETIME",
    },
    "user_sessions": {
        "device_label": "VARCHAR(60)",
    },
}

# (index name, table, column expression). Created only if missing.
INDEXES = (
    ("ix_activities_status_event_date", "activities", "status, event_date"),
    ("ix_activities_ngo_id", "activities", "ngo_id"),
    ("ix_activity_signups_volunteer_id", "activity_signups", "volunteer_id"),
    ("ix_user_sessions_role_user", "user_sessions", "user_role, user_id"),
)

# Tables whose email column must be unique ignoring case.
EMAIL_TABLES = ("volunteers", "ngos")


def _add_missing_columns(engine, table: str, columns: dict) -> list[str]:
    """ALTER TABLE ... ADD COLUMN for each missing column; returns the added names.

    Adding a nullable column without a default leaves every existing row
    untouched. A table that does not exist yet is skipped (create_all makes it).
    """

    added = []

    with engine.begin() as conn:
        existing = {
            row[1]
            for row in conn.execute(text(f"PRAGMA table_info({table})"))
        }

        if not existing:
            return added

        for name, col_type in columns.items():
            if name in existing:
                continue

            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}"))
            logger.info("Added %s.%s (%s)", table, name, col_type)
            added.append(name)

    return added


def ensure_signup_columns(engine):
    """Add any missing activity_signups columns. Safe to run on every startup."""

    return _add_missing_columns(engine, "activity_signups", SIGNUP_COLUMNS)


def ensure_contact_columns(engine):
    """Add read_at / archived_at to contact_messages if missing (no row rewrite)."""

    return _add_missing_columns(engine, "contact_messages", CONTACT_COLUMNS)


def ensure_verification_columns(engine) -> dict:
    """Add volunteers/ngos.email_verified (existing accounts read as verified)."""

    return {
        table: _add_missing_columns(engine, table, ACCOUNT_COLUMNS)
        for table in EMAIL_TABLES
    }


def ensure_verification_table(engine) -> None:
    """Create email_verification_tokens if missing (create_all also does this)."""

    try:
        from .db_models import EmailVerificationTokenDB
    except ImportError:
        from db_models import EmailVerificationTokenDB

    EmailVerificationTokenDB.__table__.create(bind=engine, checkfirst=True)


def ensure_settings_columns(engine) -> dict:
    """Add the Settings columns (profile extras, deactivation, session label)."""

    return {
        table: _add_missing_columns(engine, table, columns)
        for table, columns in SETTINGS_COLUMNS.items()
    }


def ensure_email_change_table(engine) -> None:
    """Create email_change_tokens if missing (create_all also does this)."""

    try:
        from .db_models import EmailChangeTokenDB
    except ImportError:
        from db_models import EmailChangeTokenDB

    EmailChangeTokenDB.__table__.create(bind=engine, checkfirst=True)


def ensure_indexes(engine):
    """Create the lookup indexes used by matching and session revocation."""

    with engine.begin() as conn:
        for name, table, columns in INDEXES:
            conn.execute(
                text(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})")
            )


def backup_database(db_path: Path, label: str) -> Path:
    """Copy the database (consistently, even in WAL mode) next to itself."""

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = db_path.with_name(f"{db_path.name}.bak-before-{label}-{stamp}")

    source = sqlite3.connect(str(db_path))
    try:
        dest = sqlite3.connect(str(target))
        try:
            source.backup(dest)
        finally:
            dest.close()
    finally:
        source.close()

    logger.info("Backed up the database to %s", target.name)
    return target


def email_collisions(conn, table: str) -> list[str]:
    """Emails that would clash once lowercased and trimmed."""

    rows = conn.execute(
        text(
            f"SELECT lower(trim(email)) AS e, count(*) FROM {table} "
            f"WHERE email IS NOT NULL GROUP BY e HAVING count(*) > 1"
        )
    ).all()

    return [row[0] for row in rows]


def normalize_emails(engine, db_path: Path) -> dict:
    """Lowercase + trim stored emails and add a unique index on lower(email).

    A table with collisions is skipped entirely (no rows changed, no index)
    and reported in the result and the log. Rows are rewritten only when at
    least one email is not already normalised, and only after a backup.
    Returns {"tables": {table: {...}}, "backup": path-or-None}.
    """

    result = {"tables": {}, "backup": None}

    with engine.connect() as conn:
        plan = {}

        for table in EMAIL_TABLES:
            collisions = email_collisions(conn, table)
            pending = conn.execute(
                text(
                    f"SELECT count(*) FROM {table} "
                    f"WHERE email IS NOT NULL AND email != lower(trim(email))"
                )
            ).scalar()
            plan[table] = {"collisions": collisions, "pending": int(pending or 0)}

    needs_rewrite = any(
        info["pending"] and not info["collisions"] for info in plan.values()
    )

    if needs_rewrite and db_path.exists():
        result["backup"] = str(backup_database(db_path, "email-normalise"))

    with engine.begin() as conn:
        for table, info in plan.items():
            if info["collisions"]:
                logger.warning(
                    "Email normalisation skipped for %s: %d address(es) would "
                    "collide once lowercased. Fix them by hand, then restart.",
                    table, len(info["collisions"]),
                )
                result["tables"][table] = {
                    "status": "skipped_collisions",
                    "collisions": info["collisions"],
                    "updated": 0,
                }
                continue

            updated = 0
            if info["pending"]:
                updated = conn.execute(
                    text(
                        f"UPDATE {table} SET email = lower(trim(email)) "
                        f"WHERE email IS NOT NULL AND email != lower(trim(email))"
                    )
                ).rowcount
                logger.info("Lowercased %d email(s) in %s", updated, table)

            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS ux_{table}_email_lower "
                    f"ON {table} (lower(email))"
                )
            )
            result["tables"][table] = {"status": "ok", "collisions": [], "updated": updated}

    return result


def run_migrations(engine, db_path: Path) -> dict:
    """Every startup migration, in order."""

    ensure_signup_columns(engine)
    ensure_contact_columns(engine)
    ensure_verification_columns(engine)
    ensure_verification_table(engine)
    ensure_settings_columns(engine)
    ensure_email_change_table(engine)
    ensure_indexes(engine)
    return normalize_emails(engine, db_path)
