"""The one IST clock (event_rules.py), including the 00:00 and 05:30 IST edges."""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import event_rules as er


def ev(day):
    return SimpleNamespace(event_date=datetime(day.year, day.month, day.day) if day else None)


def test_phases_around_the_day():
    day = date(2026, 11, 17)
    assert er.event_phase(ev(day), date(2026, 11, 16)) == er.OPEN
    assert er.event_phase(ev(day), date(2026, 11, 17)) == er.IN_PROGRESS
    assert er.event_phase(ev(day), date(2026, 11, 18)) == er.COMPLETED
    assert er.event_phase(ev(None), date(2030, 1, 1)) == er.OPEN


def test_midnight_and_0530_ist(freeze_today):
    day = date(2026, 11, 17)
    freeze_today("2026-11-16 23:59")
    assert er.is_open(ev(day))
    freeze_today("2026-11-17 00:00")
    assert er.event_phase(ev(day)) == er.IN_PROGRESS
    # 05:30 IST is 00:00 UTC: the old UTC clock changed here, the new one does not.
    freeze_today("2026-11-17 05:30")
    assert er.event_phase(ev(day)) == er.IN_PROGRESS
    freeze_today("2026-11-18 00:00")
    assert er.is_completed(ev(day))


def test_browser_dates_map_to_the_chosen_day():
    sent = datetime(2026, 11, 17, 0, 0, tzinfo=timezone.utc)  # new Date("2026-11-17").toISOString()
    assert er.to_storage(sent) == datetime(2026, 11, 17)
    ist_evening = datetime(2026, 11, 17, 23, 0, tzinfo=er.IST)
    assert er.to_event_day(ist_evening) == date(2026, 11, 17)
    assert er.to_storage(date(2026, 1, 2)) == datetime(2026, 1, 2)
    assert er.to_storage(None) is None


def test_date_problem():
    today = date(2026, 11, 16)
    assert er.date_problem(datetime(2026, 11, 15), today)
    assert er.date_problem(datetime(2026, 11, 16), today)
    assert er.date_problem(datetime(2026, 11, 17), today) is None
    assert er.date_problem(None, today) is None


def test_sql_bounds():
    today = date(2026, 11, 16)
    assert er.first_open_day_start(today) == datetime(2026, 11, 17)
    assert er.today_start(today) == datetime(2026, 11, 16)
    assert er.first_open_day_start(today) - er.today_start(today) == timedelta(days=1)
