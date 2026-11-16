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

# (index name, table, column expression). Created only if missing.
INDEXES = (
    ("ix_activities_status_event_date", "activities", "status, event_date"),
    ("ix_activities_ngo_id", "activities", "ngo_id"),
    ("ix_activity_signups_volunteer_id", "activity_signups", "volunteer_id"),
    ("ix_user_sessions_role_user", "user_sessions", "user_role, user_id"),
)

# Tables whose email column must be unique ignoring case.
EMAIL_TABLES = ("volunteers", "ngos")


def ensure_signup_columns(engine):
    """Add any missing activity_signups columns. Safe to run on every startup."""

    with engine.begin() as conn:
        existing = {
            row[1]
            for row in conn.execute(
                text("PRAGMA table_info(activity_signups)")
            )
        }

        for name, col_type in SIGNUP_COLUMNS.items():
            if name in existing:
                continue

            conn.execute(
                text(
                    f"ALTER TABLE activity_signups "
                    f"ADD COLUMN {name} {col_type}"
                )
            )
            logger.info("Added activity_signups.%s (%s)", name, col_type)


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
    ensure_indexes(engine)
    return normalize_emails(engine, db_path)
