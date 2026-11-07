"""Backend settings, read once from plain environment variables.

Every default reproduces the local setup, so nothing has to be set to run the
app on a laptop. backend/.env.example documents each variable.

DATA_DIR holds everything the app writes and must keep between restarts:
voluntag.db, uploads/ (with messages/ and resolutions/) and admin_secret.json.
"""

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent

DEFAULT_ALLOWED_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


def _env_text(name: str) -> str:
    """Return the variable without surrounding spaces ("" when unset)."""
    return os.environ.get(name, "").strip()


def _env_bool(name: str, default: bool) -> bool:
    """Read true/false (also 1/0, yes/no, on/off); blank or unset gives default."""
    raw = _env_text(name).lower()

    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False

    raise ValueError(f"{name} must be true or false, not {os.environ[name]!r}")


def _env_list(name: str, default) -> list[str]:
    """Read a comma-separated list; blank or unset gives default."""
    raw = _env_text(name)

    if not raw:
        return list(default)

    # Browsers send Origin without a trailing slash, so drop one if given.
    items = [item.strip().rstrip("/") for item in raw.split(",")]
    items = [item for item in items if item]

    if not items:
        raise ValueError(f"{name} is set but lists no values: {os.environ[name]!r}")

    return items


_data_dir = _env_text("DATA_DIR")
DATA_DIR = Path(_data_dir).expanduser().resolve() if _data_dir else BACKEND_DIR

DATABASE_PATH = DATA_DIR / "voluntag.db"
UPLOAD_DIR = DATA_DIR / "uploads"
MESSAGES_UPLOAD_DIR = UPLOAD_DIR / "messages"
RESOLUTIONS_UPLOAD_DIR = UPLOAD_DIR / "resolutions"
ADMIN_SECRET_PATH = DATA_DIR / "admin_secret.json"

ALLOWED_ORIGINS = _env_list("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
SEED_DEMO_DATA = _env_bool("SEED_DEMO_DATA", True)

for _folder in (DATA_DIR, UPLOAD_DIR, MESSAGES_UPLOAD_DIR, RESOLUTIONS_UPLOAD_DIR):
    _folder.mkdir(parents=True, exist_ok=True)
