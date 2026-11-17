"""Password policy for new volunteer and NGO registrations.

Only registration calls this. Login and existing accounts are not affected.
frontend/src/components/PasswordRules.jsx shows the same rules as a live
checklist, so keep the two in step when changing a rule.

The password is checked exactly as received: nothing is trimmed or altered.
"""

import unicodedata


MIN_LENGTH = 8
MAX_LENGTH = 64


def _is_special(char: str) -> bool:
    """Anything that is not a letter, a digit or whitespace."""
    category = unicodedata.category(char)
    return not (
        category.startswith("L")
        or category == "Nd"
        or char.isspace()
    )


def unmet_password_rules(password: str) -> list[str]:
    """Return the rules this password does not meet (empty list = valid)."""
    unmet: list[str] = []

    if not MIN_LENGTH <= len(password) <= MAX_LENGTH:
        unmet.append(f"{MIN_LENGTH} to {MAX_LENGTH} characters")

    categories = {unicodedata.category(char) for char in password}

    if "Lu" not in categories:
        unmet.append("an uppercase letter")

    if "Ll" not in categories:
        unmet.append("a lowercase letter")

    if "Nd" not in categories:
        unmet.append("a digit")

    if not any(_is_special(char) for char in password):
        unmet.append("a special character")

    return unmet


def password_policy_error(password: str):
    """Return a message naming the unmet rules, or None if the password passes."""
    unmet = unmet_password_rules(password)

    if not unmet:
        return None

    return "Password must have: " + ", ".join(unmet) + "."
