"""Admin correction of a rating / attendance, with an audit entry."""

from datetime import datetime

from conftest import admin_token, auth, db_session, register_ngo, register_volunteer
from db_models import ActivityDB, ActivitySignupDB, AdminActionDB, VolunteerDB


def make_signup(client, approved=True, day=datetime(2026, 11, 1), status="Active", **signup):
    ngo_id = register_ngo(client, "org@example.test")
    register_volunteer(client, "vol@example.test")
    db = db_session()
    vid = db.query(VolunteerDB.id).scalar()
    ev = ActivityDB(ngo_id=ngo_id, title="Past", required_skills="x", event_date=day, status=status)
    db.add(ev)
    db.flush()
    db.add(ActivitySignupDB(activity_id=ev.id, volunteer_id=vid, approved_at=datetime(2026, 10, 1) if approved else None, **signup))
    db.commit()
    eid = ev.id
    db.close()
    return eid, vid


def url(eid, vid):
    return f"/admin/events/{eid}/volunteers/{vid}/feedback-override"


def test_override_changes_rating_and_logs(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    eid, vid = make_signup(client, attendance_status="not_attended")
    token = admin_token()
    res = client.post(url(eid, vid), headers=auth(token), json={
        "attendance": "attended", "rating": 4, "feedback": "Was there after all", "reason": "NGO typo",
    })
    assert res.status_code == 200, res.text
    assert res.json()["previous"]["attendance_status"] == "not_attended"
    db = db_session()
    signup = db.query(ActivitySignupDB).one()
    log = db.query(AdminActionDB).filter(AdminActionDB.action == "override_feedback").one()
    db.close()
    assert (signup.attendance_status, signup.rating) == ("attended", 4)
    assert "NGO typo" in log.details and log.target_id == f"{eid}:{vid}"


def test_override_guards(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    eid, vid = make_signup(client, approved=False)
    token = admin_token()
    body = {"attendance": "not_attended", "reason": "check"}
    assert client.post(url(eid, vid), json=body).status_code == 401
    assert client.post(url(eid, vid), headers=auth(token), json=body).status_code == 400
    assert client.post(url(eid, vid), headers=auth(token), json={**body, "reason": "x"}).status_code == 422
    assert client.post(url(eid, 999), headers=auth(token), json=body).status_code == 404


def test_override_needs_completed_event(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    eid, vid = make_signup(client, day=datetime(2026, 12, 1))
    body = {"attendance": "attended", "rating": 6, "feedback": "x", "reason": "check"}
    res = client.post(url(eid, vid), headers=auth(admin_token()), json=body)
    assert res.status_code == 400
