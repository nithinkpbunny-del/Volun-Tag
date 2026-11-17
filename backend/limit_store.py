"""Persistent store behind every rate limit (stdlib sqlite3, no new dependency).

All limiters (logins, registrations, email verification, password reset,
contact form, reports) keep their counters in ONE small SQLite file,
settings.RATE_LIMIT_DB_PATH (default DATA_DIR/ratelimits.db), separate from
voluntag.db. Because the counters live on disk:

* a restart does not clear them, and
* several worker processes see the same counters (each check-and-record runs
  in one BEGIN IMMEDIATE transaction, so two processes cannot both slip
  under a limit).

Keys (emails, IP addresses) are never stored as typed: each is hashed with a
random salt that is created once and kept in the same file, so the file
holds no personal data in readable form.

Two kinds of rows:
* hits  - one row per counted event, with the time it stops counting;
* locks - "this key is blocked until <time>".
Expired rows are removed as keys are touched and by a periodic purge.

Times use time.time() (wall clock), since monotonic time restarts with the
process. Tests replace `clock`.
"""

import hashlib
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hits (
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    subject TEXT,
    at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_hits_bucket_key_at ON hits (bucket, key, at);
CREATE INDEX IF NOT EXISTS ix_hits_bucket_subject ON hits (bucket, subject);
CREATE INDEX IF NOT EXISTS ix_hits_expires_at ON hits (expires_at);
CREATE TABLE IF NOT EXISTS locks (
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    subject TEXT,
    until REAL NOT NULL,
    PRIMARY KEY (bucket, key)
);
CREATE INDEX IF NOT EXISTS ix_locks_bucket_subject ON locks (bucket, subject);
"""

# A full purge of expired rows runs every this many writes.
PURGE_EVERY = 500

clock = time.time


def _now() -> float:
    return clock()


def _key_text(key) -> str:
    """One string for a str or tuple key ("\x1f" cannot be typed into a form)."""
    if isinstance(key, (tuple, list)):
        return "\x1f".join(str(part) for part in key)
    return str(key)


class LimitStore:
    """Counters and locks in one SQLite file. Safe across threads and processes."""

    def __init__(self, path):
        self.path = Path(path)
        self._local = threading.local()
        self._salt = None
        self._writes = 0
        self._writes_lock = threading.Lock()

    # ── connection ────────────────────────────────────────────────
    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)

        if conn is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(
                str(self.path), timeout=5, isolation_level=None, check_same_thread=False,
            )
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.executescript(SCHEMA)
            self._local.conn = conn

        return conn

    def close(self) -> None:
        """Close this thread's connection (the next call opens a new one)."""
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    @contextmanager
    def _tx(self):
        conn = self._conn()
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
        self._after_write()

    def _after_write(self) -> None:
        with self._writes_lock:
            self._writes += 1
            due = self._writes % PURGE_EVERY == 0
        if due:
            self.purge()

    # ── hashing ───────────────────────────────────────────────────
    def _get_salt(self) -> str:
        if self._salt is None:
            conn = self._conn()
            conn.execute(
                "INSERT OR IGNORE INTO meta (name, value) VALUES ('salt', ?)",
                (secrets.token_hex(16),),
            )
            self._salt = conn.execute("SELECT value FROM meta WHERE name = 'salt'").fetchone()[0]
        return self._salt

    def h(self, key) -> str:
        """The stored form of a key: salted sha256."""
        return hashlib.sha256((self._get_salt() + _key_text(key)).encode("utf-8")).hexdigest()

    # ── sliding-window counters ───────────────────────────────────
    @staticmethod
    def _trim(conn, bucket: str, key: str, now: float, window: float) -> None:
        conn.execute(
            "DELETE FROM hits WHERE bucket = ? AND key = ? AND at <= ?",
            (bucket, key, now - window),
        )

    def hit(self, bucket: str, key, limit: int, window: float, subject=None) -> float:
        """Count one event unless the key is at its limit.

        Returns 0 when the event was allowed (and counted), else the seconds
        until one becomes free. A refused event is NOT counted, so a blocked
        client cannot extend its own block.
        """
        hk = self.h(key)
        hs = self.h(subject) if subject is not None else None
        now = _now()

        with self._tx() as conn:
            self._trim(conn, bucket, hk, now, window)
            count, oldest = conn.execute(
                "SELECT count(*), min(at) FROM hits WHERE bucket = ? AND key = ?",
                (bucket, hk),
            ).fetchone()

            if count >= limit:
                return max(0.001, oldest + window - now)

            conn.execute(
                "INSERT INTO hits (bucket, key, subject, at, expires_at) VALUES (?, ?, ?, ?, ?)",
                (bucket, hk, hs, now, now + window),
            )
            return 0.0

    def add(self, bucket: str, key, window: float, subject=None) -> int:
        """Count one event unconditionally; returns the count inside the window."""
        hk = self.h(key)
        hs = self.h(subject) if subject is not None else None
        now = _now()

        with self._tx() as conn:
            self._trim(conn, bucket, hk, now, window)
            conn.execute(
                "INSERT INTO hits (bucket, key, subject, at, expires_at) VALUES (?, ?, ?, ?, ?)",
                (bucket, hk, hs, now, now + window),
            )
            return conn.execute(
                "SELECT count(*) FROM hits WHERE bucket = ? AND key = ?", (bucket, hk),
            ).fetchone()[0]

    def over_limit(self, bucket: str, key, limit: int, window: float) -> float:
        """Seconds until the key is under `limit` again (0 if it already is). Records nothing."""
        now = _now()
        count, oldest = self._conn().execute(
            "SELECT count(*), min(at) FROM hits WHERE bucket = ? AND key = ? AND at > ?",
            (bucket, self.h(key), now - window),
        ).fetchone()

        if count < limit:
            return 0.0

        # The (count - limit + 1)-th oldest hit has to age out first.
        nth = self._conn().execute(
            "SELECT at FROM hits WHERE bucket = ? AND key = ? AND at > ? "
            "ORDER BY at LIMIT 1 OFFSET ?",
            (bucket, self.h(key), now - window, count - limit),
        ).fetchone()
        return max(0.001, (nth[0] if nth else oldest) + window - now)

    # ── locks ─────────────────────────────────────────────────────
    def lock(self, bucket: str, key, seconds: float, subject=None) -> None:
        hk = self.h(key)
        hs = self.h(subject) if subject is not None else None

        with self._tx() as conn:
            conn.execute(
                "INSERT INTO locks (bucket, key, subject, until) VALUES (?, ?, ?, ?) "
                "ON CONFLICT (bucket, key) DO UPDATE SET until = excluded.until, subject = excluded.subject",
                (bucket, hk, hs, _now() + seconds),
            )

    def locked_for(self, bucket: str, key) -> float:
        """Seconds left on the key's lock (0 when not locked)."""
        row = self._conn().execute(
            "SELECT until FROM locks WHERE bucket = ? AND key = ?", (bucket, self.h(key)),
        ).fetchone()
        return max(0.0, row[0] - _now()) if row else 0.0

    # ── clearing ──────────────────────────────────────────────────
    def clear(self, bucket: str, key) -> None:
        """Forget the key's hits and lock."""
        hk = self.h(key)
        with self._tx() as conn:
            conn.execute("DELETE FROM hits WHERE bucket = ? AND key = ?", (bucket, hk))
            conn.execute("DELETE FROM locks WHERE bucket = ? AND key = ?", (bucket, hk))

    def clear_subject(self, bucket: str, subject) -> None:
        """Forget every key recorded with this subject (for example one account on every IP)."""
        hs = self.h(subject)
        with self._tx() as conn:
            conn.execute("DELETE FROM hits WHERE bucket = ? AND subject = ?", (bucket, hs))
            conn.execute("DELETE FROM locks WHERE bucket = ? AND subject = ?", (bucket, hs))

    def clear_bucket(self, bucket: str) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM hits WHERE bucket = ?", (bucket,))
            conn.execute("DELETE FROM locks WHERE bucket = ?", (bucket,))

    def clear_all(self) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM hits")
            conn.execute("DELETE FROM locks")

    def purge(self) -> int:
        """Delete every expired hit and lock; returns how many rows went."""
        now = _now()
        conn = self._conn()
        conn.execute("BEGIN IMMEDIATE")
        try:
            removed = conn.execute("DELETE FROM hits WHERE expires_at <= ?", (now,)).rowcount
            removed += conn.execute("DELETE FROM locks WHERE until <= ?", (now,)).rowcount
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
        return removed

    def row_counts(self) -> dict:
        conn = self._conn()
        return {
            "hits": conn.execute("SELECT count(*) FROM hits").fetchone()[0],
            "locks": conn.execute("SELECT count(*) FROM locks").fetchone()[0],
        }
