"""Report a problem: mismatch gate, cleanup, per-user rate limit."""

import settings
from conftest import TEST_DATA_DIR, auth, db_session, login, png_bytes, register_ngo, register_volunteer
from db_models import EmbeddingDB, IssueDB


def files_in_uploads():
    return sorted(p.name for p in (TEST_DATA_DIR / "uploads").iterdir() if p.is_file())


def report(client, token, description="Plastic waste dumped near the lake", n_images=1):
    files = [("images", (f"p{i}.png", png_bytes(), "image/png")) for i in range(n_images)]
    return client.post(
        "/report-issue",
        data={"user_description": description, "location": "Pune", "reporter_email": "vol@example.test"},
        files=files or None,
        headers=auth(token),
    )


def setup(client):
    register_ngo(client, "org@example.test", category="Environment", motto="Cleaning lakes and plastic waste")
    register_volunteer(client, "vol@example.test")
    return login(client, "volunteer", "vol@example.test")


def counts():
    db = db_session()
    try:
        return db.query(IssueDB).count(), db.query(EmbeddingDB).filter(EmbeddingDB.owner_type.like("issue%")).count()
    finally:
        db.close()


def test_matching_photo_is_accepted_and_analysis_reused(client, fake_images, monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MISMATCH_MODE", "enforce")
    token = setup(client)
    fake_images.similarity = settings.REPORT_MISMATCH_CLIP_MIN + 0.05
    res = report(client, token)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["ai_image_caption"] == "a photo of a street"
    assert body["recommended_ngos"][0]["ngo"] == "org"
    # BLIP/CLIP ran once for the gate; the pipeline reused it.
    assert len(fake_images.calls) == 1
    assert fake_images.calls[0]["description"] == "Plastic waste dumped near the lake"


def test_mismatch_is_rejected_and_nothing_stored(client, fake_images, monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MISMATCH_MODE", "enforce")
    token = setup(client)
    before_files = files_in_uploads()
    fake_images.similarity = settings.REPORT_MISMATCH_CLIP_MIN - 0.05

    res = report(client, token, n_images=2)
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "image_description_mismatch"
    assert "photo" in body["message"] and body["detail"] == body["message"]
    assert counts() == (0, 0)
    assert files_in_uploads() == before_files


def test_one_matching_photo_is_enough(client, fake_images, monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MISMATCH_MODE", "enforce")
    token = setup(client)
    low = settings.REPORT_MISMATCH_CLIP_MIN - 0.05

    def analysis(paths, description=None, **_):
        import issue_ai_pipeline
        a = issue_ai_pipeline.ImageAnalysis(images_read=len(paths))
        a.similarities = [low, settings.REPORT_MISMATCH_CLIP_MIN + 0.01][: len(paths)]
        return a

    import main
    monkeypatch.setattr(main, "analyse_images", analysis)
    assert report(client, token, n_images=2).status_code == 201


def test_log_mode_accepts(client, fake_images, monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MISMATCH_MODE", "log")
    token = setup(client)
    fake_images.similarity = 0.0
    assert report(client, token).status_code == 201
    assert counts()[0] == 1


def test_off_mode_skips_the_check(client, fake_images, monkeypatch):
    monkeypatch.setattr(settings, "REPORT_MISMATCH_MODE", "off")
    token = setup(client)
    fake_images.similarity = 0.0
    assert report(client, token).status_code == 201
    assert fake_images.calls[0]["description"] is None


def test_text_only_report_skips_the_check(client, fake_images):
    token = setup(client)
    assert report(client, token, n_images=0).status_code == 201
    assert fake_images.calls == []


def test_not_an_image_rejected_without_leftovers(client):
    token = setup(client)
    before = files_in_uploads()
    res = client.post(
        "/report-issue",
        data={"user_description": "x", "location": "Pune", "reporter_email": "vol@example.test"},
        files=[("images", ("a.png", png_bytes(), "image/png")), ("images", ("b.png", b"nope", "image/png"))],
        headers=auth(token),
    )
    assert res.status_code == 400
    assert files_in_uploads() == before and counts()[0] == 0


def test_per_user_rate_limit(client):
    token = setup(client)
    for _ in range(settings.REPORT_LIMIT_PER_HOUR):
        assert report(client, token, n_images=0).status_code == 201
    res = report(client, token, n_images=0)
    assert res.status_code == 429 and "Retry-After" in res.headers
