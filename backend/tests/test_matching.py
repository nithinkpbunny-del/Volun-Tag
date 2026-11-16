"""Scoring parts, the ratings bonus and the v1/v2 switch."""

import matching
import settings
from conftest import auth, db_session, login, register_ngo, register_volunteer


def test_v1_matches_the_old_formula():
    final, exp = matching.score_match(
        0.40, "Teaching, tutoring and literacy", "teaching", "Education",
        "Pune, India", "Pune, India", v2=False,
    )
    old = 0.40 + matching.compute_category_boost("Teaching, tutoring and literacy", "Education") + 0.10
    assert abs(final - old) < 1e-9
    assert exp["matched_keywords"] == ["teaching", "tutoring", "literacy"]
    assert exp["same_city"] == "Pune" and exp["rating_bonus"] == 0
    assert "Matched on" in exp["summary"]


def test_v2_word_forms_and_overlap():
    assert matching.stem("teachers") == matching.stem("teaching") == "teach"
    assert matching.stem("nurse") == matching.stem("nursing")
    assert matching.matched_keywords("teacher, tutor", "Education") == []
    assert set(matching.matched_keywords_v2("teacher, tutor, students", "Education")) >= {"teaching", "tutoring", "student"}
    assert matching.skill_overlap("first aid, nursing", "First aid and nurse support") > 0


def test_rating_bonus_rules(monkeypatch):
    monkeypatch.setattr(settings, "MATCH_USE_RATINGS", True)
    assert matching.rating_bonus_fraction(2, 5.0) == 0.0          # too few ratings
    assert matching.rating_bonus_fraction(3, 1.0) == 0.0          # 1-star mean
    assert abs(matching.rating_bonus_fraction(3, 5.0) - 0.05) < 1e-12
    final, exp = matching.score_match(0.6, "x", "y", None, rating_stats=(4, 5.0), v2=False)
    assert abs(final - 0.63) < 1e-9 and exp["rating_bonus"] == 0.03
    assert "rating bonus" in exp["summary"].lower()
    monkeypatch.setattr(settings, "MATCH_USE_RATINGS", False)
    assert matching.rating_bonus_fraction(10, 5.0) == 0.0


def test_bonus_never_exceeds_five_percent(monkeypatch):
    monkeypatch.setattr(settings, "MATCH_RATING_MAX_BONUS", 0.05)
    for semantic in (0.1, 0.5, 0.9):
        base, _ = matching.score_match(semantic, "x", "y", None, rating_stats=(0, None), v2=False)
        final, _ = matching.score_match(semantic, "x", "y", None, rating_stats=(9, 5.0), v2=False)
        assert final - base <= 0.05 * base + 1e-9


def test_ratings_reach_the_volunteer_events_endpoint(client, freeze_today):
    """End to end: 3 rated events -> bonus appears; it is zero with fewer."""
    from db_models import ActivityDB, ActivitySignupDB, VolunteerDB
    from datetime import datetime

    freeze_today("2026-11-16 10:00")
    register_ngo(client, "org@example.test")
    register_volunteer(client, "vol@example.test")
    ngo = login(client, "ngo", "org@example.test")
    vol = login(client, "volunteer", "vol@example.test")
    client.post("/organize-event/org@example.test", headers=auth(ngo), json={
        "title": "Reading", "required_skills": "Teaching children reading and writing", "event_date": "2026-11-30",
    })

    def bonus():
        rows = client.get("/volunteer-events/vol@example.test", headers=auth(vol)).json()
        return rows[0]["explanation"]["rating_bonus"]

    db = db_session()
    vid = db.query(VolunteerDB.id).scalar()
    ngo_id = db.query(ActivityDB.ngo_id).scalar()
    for i in range(3):
        past = ActivityDB(ngo_id=ngo_id, title=f"Past {i}", required_skills="x", event_date=datetime(2026, 1, 1 + i), status="Active")
        db.add(past)
        db.flush()
        db.add(ActivitySignupDB(activity_id=past.id, volunteer_id=vid, approved_at=datetime(2025, 12, 1),
                                attendance_status="attended", rating=5, feedback="ok"))
        db.commit()
        if i == 1:
            assert bonus() == 0
    db.close()
    assert 0 < bonus() <= 0.05
