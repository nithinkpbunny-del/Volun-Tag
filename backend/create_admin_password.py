"""Generate the admin console password and store only its salted hash.

Run from the backend folder with the venv active:

    python create_admin_password.py          # first-time setup
    python create_admin_password.py --reset  # replace an existing password

The password is printed once. backend/admin_secret.json holds only the salt,
iteration count and PBKDF2-SHA256 hash, and is git-ignored.
"""

import argparse
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path


SECRET_PATH = Path(__file__).resolve().with_name("admin_secret.json")
ITERATIONS = 310000


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--reset",
        action="store_true",
        help="overwrite an existing admin_secret.json",
    )
    args = parser.parse_args()

    if SECRET_PATH.exists() and not args.reset:
        print(
            f"{SECRET_PATH} already exists. "
            "Run with --reset to replace the admin password.",
            file=sys.stderr,
        )
        return 1

    password = secrets.token_urlsafe(18)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        ITERATIONS,
    )

    data = {
        "salt": salt.hex(),
        "iterations": ITERATIONS,
        "hash": digest.hex(),
    }

    # Owner read/write only; chmod also covers an existing file on --reset.
    fd = os.open(SECRET_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)
        file.write("\n")
    os.chmod(SECRET_PATH, 0o600)

    print(f"Wrote {SECRET_PATH}")
    print()
    print(f"Admin password: {password}")
    print()
    print("Save this now, it will not be shown again.")

    if args.reset:
        print(
            "Note: admin sessions that are already logged in stay valid "
            "until they expire (at most 8 hours)."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
