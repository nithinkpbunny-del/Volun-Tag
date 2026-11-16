"""One clock for events: date-only, India Standard Time everywhere.

An event has a calendar day (no time of day). Its phase, computed on the
server and sent to every screen, is:

* "open"         the event day has not started yet (IST): volunteers can
                 join and leave, the NGO can approve and remove.
* "in_progress"  it is the event day (IST): registration is closed.
* "completed"    the event day is over (IST): the NGO can rate attendance.

An event without a date stays "open". "Completed" is never stored; status
(Active / Filled / Cancelled) is a separate thing the NGO controls.

Dates are stored in activities.event_date as naive midnight of the event
day. Older rows were sent by the browser as "YYYY-MM-DDT00:00:00Z" (UTC
midnight of the chosen day), which is the same thing.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

IST = timezone(timedelta(hours=5, minutes=30), "IST")

OPEN = "open"
IN_PROGRESS = "in_progress"
COMPLETED = "completed"
PHASES = (OPEN, IN_PROGRESS, COMPLETED)


def now_ist() -> datetime:
    """The current time in IST (tests patch this)."""
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def to_event_day(value) -> Optional[date]:
    """The calendar day for a submitted or stored event date.

    * date -> itself
    * aware datetime -> its UTC calendar day (what browsers send)
    * naive datetime -> its calendar day
    * None -> None
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        return value.date()
    if isinstance(value, date):
        return value
    raise TypeError(f"not a date: {value!r}")


def to_storage(value) -> Optional[datetime]:
    """Naive midnight of the event day, the stored form."""
    day = to_event_day(value)
    return datetime(day.year, day.month, day.day) if day else None


def event_day(event) -> Optional[date]:
    return to_event_day(getattr(event, "event_date", None))


def event_day_text(event) -> Optional[str]:
    day = event_day(event)
    return day.isoformat() if day else None


def phase_for_day(day: Optional[date], today: Optional[date] = None) -> str:
    if day is None:
        return OPEN
    today = today or today_ist()
    if today < day:
        return OPEN
    if today == day:
        return IN_PROGRESS
    return COMPLETED


def event_phase(event, today: Optional[date] = None) -> str:
    return phase_for_day(event_day(event), today)


def is_open(event, today: Optional[date] = None) -> bool:
    """Registration (join, leave, approve, remove) is allowed."""
    return event_phase(event, today) == OPEN


def is_completed(event, today: Optional[date] = None) -> bool:
    return event_phase(event, today) == COMPLETED


def first_open_day_start(today: Optional[date] = None) -> datetime:
    """Stored value of the earliest day that is still open (tomorrow, IST).

    SQL filter for open events: event_date IS NULL OR event_date >= this.
    """
    day = (today or today_ist()) + timedelta(days=1)
    return datetime(day.year, day.month, day.day)


def today_start(today: Optional[date] = None) -> datetime:
    """Stored value of today's date (IST): event_date >= this = not completed."""
    day = today or today_ist()
    return datetime(day.year, day.month, day.day)


def date_problem(value, today: Optional[date] = None) -> Optional[str]:
    """Why a new or changed event date is not allowed, or None if it is fine.

    Registration closes when the event day starts, so the earliest usable
    day is tomorrow (IST).
    """
    day = to_event_day(value)
    if day is None:
        return None
    today = today or today_ist()
    if day < today:
        return "The event date is in the past."
    if day == today:
        return (
            "Registration closes when the event day starts, so choose a date "
            "from tomorrow onwards."
        )
    return None
