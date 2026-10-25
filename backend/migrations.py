import logging

from sqlalchemy import text


logger = logging.getLogger(__name__)

SIGNUP_COLUMNS = {
    "approved_at": "DATETIME",
    "attended_at": "DATETIME",
    "feedback": "TEXT",
    "rating": "INTEGER",
    "attendance_status": "VARCHAR(20)",
}


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
