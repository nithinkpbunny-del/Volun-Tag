"""One-off: hash the plain-text passwords already stored for volunteers and NGOs.

Run from the backend folder with the backend STOPPED:

    python migrate_hash_passwords.py path/to/voluntag.db           # dry run
    python migrate_hash_passwords.py path/to/voluntag.db --apply   # write

The dry run opens the database read-only and prints counts only.

--apply first writes a timestamped backup copy next to the database file,
then, in ONE transaction, for the volunteers and ngos tables:
  - plain-text passwords are replaced by their hash (password_hashing.py),
  - the old demo password "seed123" is cleared to NULL (no login possible),
  - values that are already hashed, and empty values, are left alone.
Running it again changes nothing: there is nothing left to hash or clear,
so no backup is made and nothing is written.

Nothing here prints a password or a hash.
"""

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

try:
    from .password_hashing import hash_password, is_hashed
except ImportError:
    from password_hashing import hash_password, is_hashed


TABLES = ("volunteers", "ngos")
SEED_PASSWORD = "seed123"

ALREADY_HASHED = "already hashed"
TO_HASH = "plain text to hash"
TO_BLANK = f'"{SEED_PASSWORD}" to blank'
EMPTY = "empty"
CATEGORIES = (ALREADY_HASHED, TO_HASH, TO_BLANK, EMPTY)


def classify(value) -> str:
    if value is None or value == "":
        return EMPTY
    if value == SEED_PASSWORD:
        return TO_BLANK
    if is_hashed(value):
        return ALREADY_HASHED
    return TO_HASH


def check_tables(conn: sqlite3.Connection) -> None:
    for table in TABLES:
        columns = [row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')]

        if not columns:
            raise SystemExit(f"Table {table!r} not found in this database.")
        if "password" not in columns:
            raise SystemExit(f"Table {table!r} has no password column.")


def scan(conn: sqlite3.Connection) -> dict:
    """Return {table: {category: [row ids]}}."""

    result = {}

    for table in TABLES:
        groups = {category: [] for category in CATEGORIES}

        for row_id, value in conn.execute(f'SELECT id, password FROM "{table}"'):
            groups[classify(value)].append(row_id)

        result[table] = groups

    return result


def print_counts(title: str, groups_by_table: dict) -> None:
    print(title)

    for table in TABLES:
        groups = groups_by_table[table]
        total = sum(len(ids) for ids in groups.values())
        print(f"  {table} ({total} rows)")

        for category in CATEGORIES:
            print(f"    {category:<22} {len(groups[category])}")


def pending_changes(groups_by_table: dict) -> int:
    return sum(
        len(groups[TO_HASH]) + len(groups[TO_BLANK])
        for groups in groups_by_table.values()
    )


def backup_path_for(db_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return db_path.with_name(f"{db_path.name}.bak-before-hash-passwords-{stamp}")


def make_backup(conn: sqlite3.Connection, destination: Path) -> None:
    if destination.exists():
        raise SystemExit(f"Backup {destination} already exists; try again in a second.")

    # The sqlite backup API gives a consistent copy even mid-write.
    with sqlite3.connect(destination) as backup_conn:
        conn.backup(backup_conn)
    backup_conn.close()


def apply(conn: sqlite3.Connection) -> dict:
    """Hash / clear in one transaction. Returns {table: (hashed, blanked)}."""

    done = {}

    conn.execute("BEGIN IMMEDIATE")

    try:
        # Re-read inside the write lock so nothing changes under us.
        groups_by_table = scan(conn)

        for table in TABLES:
            groups = groups_by_table[table]

            for row_id in groups[TO_HASH]:
                (value,) = conn.execute(
                    f'SELECT password FROM "{table}" WHERE id = ?', (row_id,)
                ).fetchone()
                conn.execute(
                    f'UPDATE "{table}" SET password = ? WHERE id = ?',
                    (hash_password(value), row_id),
                )

            for row_id in groups[TO_BLANK]:
                conn.execute(
                    f'UPDATE "{table}" SET password = NULL WHERE id = ? AND password = ?',
                    (row_id, SEED_PASSWORD),
                )

            done[table] = (len(groups[TO_HASH]), len(groups[TO_BLANK]))

        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise

    return done


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("db_path", help="path to the .db file")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the changes (default is a dry run that changes nothing)",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()

    if not db_path.is_file():
        print(f"No such file: {db_path}", file=sys.stderr)
        return 1

    if not args.apply:
        conn = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)

        try:
            check_tables(conn)
            groups_by_table = scan(conn)
        finally:
            conn.close()

        print_counts(f"DRY RUN, nothing written: {db_path}", groups_by_table)
        print(f"Rows that --apply would change: {pending_changes(groups_by_table)}")
        return 0

    conn = sqlite3.connect(db_path, isolation_level=None)

    try:
        check_tables(conn)
        before = scan(conn)
        print_counts(f"Before: {db_path}", before)

        if pending_changes(before) == 0:
            print("Nothing to change: no backup made, nothing written.")
            return 0

        backup = backup_path_for(db_path)
        make_backup(conn, backup)
        print(f"Backup written: {backup}")

        done = apply(conn)

        for table, (hashed, blanked) in done.items():
            print(f"  {table}: hashed {hashed}, cleared {blanked}")

        after = scan(conn)
    finally:
        conn.close()

    print_counts("After:", after)

    if pending_changes(after) != 0:
        print("WARNING: some rows still need changes.", file=sys.stderr)
        return 1

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
