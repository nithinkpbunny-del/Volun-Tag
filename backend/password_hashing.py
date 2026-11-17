"""Salted password hashes for volunteer and NGO accounts.

Uses PBKDF2-HMAC-SHA256 with the same iteration count and salt size as the
admin secret (create_admin_password.py). A stored value is one string:

    pbkdf2_sha256$<iterations>$<salt, base64>$<hash, base64>

The password is hashed exactly as received: nothing is trimmed or altered.
Nothing here prints or logs a password or a hash.
"""

import base64
import binascii
import hashlib
import hmac
import secrets


ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 310000
SALT_BYTES = 16

# Refuse absurd iteration counts in a stored value instead of hanging on them.
_MAX_ITERATIONS = 10_000_000


def _to_bytes(plain: str) -> bytes:
    # "surrogatepass" so an unpaired surrogate (possible in JSON input) is
    # hashed instead of raising; every normal string encodes as plain UTF-8.
    return plain.encode("utf-8", "surrogatepass")


def _derive(plain: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", _to_bytes(plain), salt, iterations)


def _b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64decode(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"), validate=True)


def _parse(stored):
    """Return (iterations, salt, digest) for a well-formed stored value, else None."""

    if not isinstance(stored, str) or not stored:
        return None

    parts = stored.split("$")

    if len(parts) != 4:
        return None

    algorithm, iterations_text, salt_text, digest_text = parts

    if algorithm != ALGORITHM:
        return None

    if not iterations_text.isascii() or not iterations_text.isdigit():
        return None

    iterations = int(iterations_text)

    if not 1 <= iterations <= _MAX_ITERATIONS:
        return None

    try:
        salt = _b64decode(salt_text)
        digest = _b64decode(digest_text)
    except (binascii.Error, ValueError):
        return None

    if not salt or len(digest) != hashlib.sha256().digest_size:
        return None

    return iterations, salt, digest


def hash_password(plain: str) -> str:
    """Hash plain with a fresh random salt and return the stored-format string."""

    salt = secrets.token_bytes(SALT_BYTES)
    digest = _derive(plain, salt, ITERATIONS)

    return "$".join(
        (ALGORITHM, str(ITERATIONS), _b64encode(salt), _b64encode(digest))
    )


def verify_password(plain, stored) -> bool:
    """True when plain matches stored. Never raises; anything malformed is False."""

    try:
        if not isinstance(plain, str):
            return False

        parsed = _parse(stored)

        if parsed is None:
            return False

        iterations, salt, digest = parsed
        candidate = _derive(plain, salt, iterations)

        return hmac.compare_digest(candidate, digest)
    except Exception:
        return False


def is_hashed(stored) -> bool:
    """True when stored is a well-formed hash in the format above."""

    return _parse(stored) is not None


# Checked against when the email is unknown (or the account has no usable
# hash), so those logins cost the same time as a wrong password.
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))
