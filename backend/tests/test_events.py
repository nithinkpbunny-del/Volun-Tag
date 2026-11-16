"""Event create -> join -> approve -> feedback, validation and the phase field."""

import database
from conftest import auth, db_session, login, register_ngo, register_volunteer
from db_models import NGODB


def setup_pair(client):
    register_ngo(client, "org@example.test", category="Education")
    register_volunteer(client, "vol@example.test", skills="Teaching, tutoring, literacy")
    return login(client, "ngo", "org@example.test"), login(client, "volunteer", "vol@example.test")


def create_event(client, ngo_token, **over):
    body = {
        "title": "Reading club", "required_skills": "Teaching, tutoring, literacy",
        "location": "Pune", "event_date": "2026-11-20T00:00:00.000Z", "spots_available": 2,
    }
    body.update(over)
    return client.post("/organize-event/org@example.test", json=body, headers=auth(ngo_token))


def vol_id():
    db = db_session()
    try:
        from db_models import VolunteerDB
        return db.query(VolunteerDB.id).filter(VolunteerDB.email == "vol@example.test").scalar()
    finally:
        db.close()


def test_full_flow_with_phase(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    ngo, vol = setup_pair(client)

    res = create_event(client, ngo)
    assert res.status_code == 201, res.text
    event = res.json()
    assert event["phase"] == "open"
    assert event["event_day"] == "2026-11-20"
    assert event["is_completed"] is False
    eid = event["id"]

    listed = client.get("/volunteer-events/vol@example.test", headers=auth(vol)).json()
    assert [e["activity_id"] for e in listed] == [eid]
    assert listed[0]["phase"] == "open"
    assert listed[0]["explanation"]["matched_keywords"]

    assert client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(vol)).status_code == 200
    vid = vol_id()
    res = client.post(f"/event-volunteers/{eid}/{vid}/approve", headers=auth(ngo))
    assert res.status_code == 200 and res.json()["approved_count"] == 1

    # Event day (IST): registration closed, approvals frozen, feedback not yet.
    freeze_today("2026-11-20 00:00")
    assert client.post(f"/event-volunteers/{eid}/{vid}/unapprove", headers=auth(ngo)).status_code == 400
    assert client.post(f"/event-volunteers/{eid}/{vid}/feedback", json={"attendance": "attended", "rating": 5, "feedback": "Great"}, headers=auth(ngo)).status_code == 400
    page = client.get(f"/event-volunteers/{eid}", headers=auth(ngo)).json()
    assert page["phase"] == "in_progress" and page["event_day"] == "2026-11-20"

    freeze_today("2026-11-21 00:01")
    res = client.post(f"/event-volunteers/{eid}/{vid}/feedback", json={"attendance": "attended", "rating": 5, "feedback": "Great"}, headers=auth(ngo))
    assert res.status_code == 200
    # One-shot.
    assert client.post(f"/event-volunteers/{eid}/{vid}/feedback", json={"attendance": "not_attended"}, headers=auth(ngo)).status_code == 400

    activity = client.get("/volunteer-activity/vol@example.test", headers=auth(vol)).json()
    assert activity[0]["phase"] == "completed"
    assert activity[0]["status_label"] == "Attended" and activity[0]["rating"] == 5

    events = client.get("/ngo-events/org@example.test", headers=auth(ngo)).json()["events"]
    assert events[0]["phase"] == "completed" and events[0]["is_completed"] is True


def test_join_closes_at_ist_midnight_not_0530(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    ngo, vol = setup_pair(client)
    eid = create_event(client, ngo, event_date="2026-11-17").json()["id"]
    freeze_today("2026-11-16 23:59")
    assert client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(vol)).status_code == 200
    assert client.delete(f"/activities/{eid}/join?volunteer_email=vol@example.test", headers=auth(vol)).status_code == 200
    freeze_today("2026-11-17 00:00")
    res = client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(vol))
    assert res.status_code == 400 and "closed" in res.json()["detail"]


def test_create_validation(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    ngo, _ = setup_pair(client)
    assert create_event(client, ngo, event_date="2026-11-15").status_code == 422  # past
    assert create_event(client, ngo, event_date="2026-11-16").status_code == 422  # today
    assert create_event(client, ngo, spots_available=0).status_code == 422
    assert create_event(client, ngo, spots_available=-5).status_code == 422
    assert create_event(client, ngo, required_skills="   ").status_code == 422
    assert create_event(client, ngo, title="  ").status_code == 422
    assert create_event(client, ngo, spots_available=None, event_date=None).status_code == 201


def test_update_validation(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    ngo, vol = setup_pair(client)
    eid = create_event(client, ngo).json()["id"]
    h = auth(ngo)

    assert client.patch(f"/update-event/{eid}", json={"title": None}, headers=h).status_code == 422
    assert client.patch(f"/update-event/{eid}", json={"required_skills": None}, headers=h).status_code == 422
    assert client.patch(f"/update-event/{eid}", json={"title": ""}, headers=h).status_code == 422
    assert client.patch(f"/update-event/{eid}", json={"event_date": "2026-11-01"}, headers=h).status_code == 422

    client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(vol))
    client.post(f"/event-volunteers/{eid}/{vol_id()}/approve", headers=h)
    res = client.patch(f"/update-event/{eid}", json={"spots_available": 0}, headers=h)
    assert res.status_code == 422
    # Below the approved count is refused; equal is fine.
    assert client.patch(f"/update-event/{eid}", json={"spots_available": 1}, headers=h).status_code == 200
    res = client.patch(f"/update-event/{eid}", json={"title": " New title ", "location": None}, headers=h)
    assert res.status_code == 200 and res.json()["title"] == "New title"
    assert res.json()["phase"] == "open"


def test_spots_cannot_drop_below_approved(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    ngo, vol = setup_pair(client)
    register_volunteer(client, "vol2@example.test", name="vol2")
    vol2 = login(client, "volunteer", "vol2@example.test")
    eid = create_event(client, ngo, spots_available=3).json()["id"]
    for email, tok in (("vol@example.test", vol), ("vol2@example.test", vol2)):
        client.post(f"/activities/{eid}/join", json={"volunteer_email": email}, headers=auth(tok))
    db = db_session()
    from db_models import VolunteerDB
    ids = [v.id for v in db.query(VolunteerDB).all()]
    db.close()
    for vid in ids:
        client.post(f"/event-volunteers/{eid}/{vid}/approve", headers=auth(ngo))
    assert client.patch(f"/update-event/{eid}", json={"spots_available": 1}, headers=auth(ngo)).status_code == 422
    assert client.patch(f"/update-event/{eid}", json={"spots_available": 2}, headers=auth(ngo)).status_code == 200


def test_no_reopen_after_date(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    ngo, _ = setup_pair(client)
    eid = create_event(client, ngo).json()["id"]
    assert client.patch(f"/event-status/{eid}", json={"status": "Cancelled"}, headers=auth(ngo)).status_code == 200
    assert client.patch(f"/event-status/{eid}", json={"status": "Active"}, headers=auth(ngo)).status_code == 200
    client.patch(f"/event-status/{eid}", json={"status": "Cancelled"}, headers=auth(ngo))
    freeze_today("2026-11-20 09:00")
    res = client.patch(f"/event-status/{eid}", json={"status": "Active"}, headers=auth(ngo))
    assert res.status_code == 400


def test_join_refused_for_rejected_ngo(client, freeze_today):
    freeze_today("2026-11-16 10:00")
    ngo, vol = setup_pair(client)
    eid = create_event(client, ngo).json()["id"]
    db = db_session()
    db.query(NGODB).update({"verification_status": "Rejected"})
    db.commit()
    db.close()
    res = client.post(f"/activities/{eid}/join", json={"volunteer_email": "vol@example.test"}, headers=auth(vol))
    assert res.status_code == 400
    assert client.get("/volunteer-events/vol@example.test", headers=auth(vol)).json() == []
