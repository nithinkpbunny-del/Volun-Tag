"""/match anonymised, /ngos login-only, upload hardening, request size cap."""

import main
import settings
from conftest import PASSWORD, TEST_DATA_DIR, auth, login, png_bytes, register_ngo, register_volunteer


def uploads_now():
    return sorted(p.name for p in (TEST_DATA_DIR / "uploads").iterdir() if p.is_file())


def test_match_is_anonymised_and_capped(client):
    register_ngo(client, "org@example.test")
    for i in range(30):
        register_volunteer(client, f"secret{i}@example.test", name=f"Secret Person {i}", location="Hidden Town, India")
        if i % 9 == 8:
            from rate_limit import reset_all
            reset_all()

    res = client.get("/match?limit=5&top_n=2")
    assert res.status_code == 200
    data = res.json()
    text = res.text
    assert "Secret Person" not in text and "Hidden Town" not in text and "@example.test" not in text
    assert data["anonymised"] is True
    assert data["returned"] == 5 and data["total_matches"] == 30
    assert [m["label"] for m in data["matches"]] == [f"Volunteer {i}" for i in range(1, 6)]
    assert "volunteer_location" not in data["matches"][0]
    assert data["matches"][0]["matches"][0]["explanation"]["summary"]
    assert client.get("/match?limit=51").status_code == 422
    # The default cap applies when no limit is given.
    assert client.get("/match").json()["returned"] == settings.MATCH_PUBLIC_ROW_LIMIT


def test_ngos_requires_login(client):
    register_ngo(client, "org@example.test")
    register_volunteer(client, "vol@example.test")
    assert client.get("/ngos").status_code == 401
    token = login(client, "volunteer", "vol@example.test")
    res = client.get("/ngos", headers=auth(token))
    assert res.status_code == 200 and res.json()[0]["email"] == "org@example.test"


def test_docs_follow_setting():
    assert (main.app.docs_url is not None) == settings.ENABLE_DOCS


def test_request_size_cap(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_REQUEST_BYTES", 1000)
    res = client.post("/add-ngo", content=b"x" * 2000, headers={"Content-Type": "application/octet-stream"})
    assert res.status_code == 413


def ngo_form(email="org@example.test", name="Org"):
    return {
        "name": name, "email": email, "contact_number": "1", "password": PASSWORD,
        "category": "Education", "location": "Pune", "motto": "m", "legal_structure": "Trust",
    }


def test_ngo_fake_document_rejected_and_cleaned(client):
    before = uploads_now()
    files = [
        ("pan_card", ("pan.pdf", b"%PDF-1.4 real enough", "application/pdf")),
        ("cert_12a", ("fake.pdf", b"MZ not a pdf", "application/pdf")),
    ]
    res = client.post("/add-ngo", data=ngo_form(), files=files)
    assert res.status_code == 400
    assert uploads_now() == before  # the valid PAN card was removed too


def test_ngo_image_checked_by_content(client):
    files = [("work_images", ("photo.png", b"<html>not an image</html>", "image/png"))]
    assert client.post("/add-ngo", data=ngo_form(), files=files).status_code == 400

    files = [("work_images", ("photo.gif", png_bytes(), "image/gif"))]
    res = client.post("/add-ngo", data=ngo_form(), files=files)
    assert res.status_code == 200
    # Stored with the real format's extension.
    assert any(n.startswith("ngo_work_") and n.endswith(".png") for n in uploads_now())


def test_document_size_cap(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_DOCUMENT_SIZE", 100)
    files = [("pan_card", ("pan.pdf", b"%PDF-" + b"0" * 500, "application/pdf"))]
    before = uploads_now()
    assert client.post("/add-ngo", data=ngo_form(), files=files).status_code == 413
    assert uploads_now() == before


def test_pixel_bomb_rejected(client, monkeypatch):
    import uploads
    monkeypatch.setattr(uploads, "MAX_IMAGE_PIXELS", 100 * 100)
    files = [("work_images", ("big.png", png_bytes(size=(200, 200)), "image/png"))]
    res = client.post("/add-ngo", data=ngo_form(), files=files)
    assert res.status_code == 400 and "too large" in res.json()["detail"]


def test_signup_rate_limits(client):
    for i in range(settings.NGO_SIGNUP_LIMIT_PER_HOUR):
        assert client.post("/add-ngo", data=ngo_form(f"o{i}@example.test", f"Org {i}")).status_code == 200
    res = client.post("/add-ngo", data=ngo_form("late@example.test", "Late"))
    assert res.status_code == 429 and "Retry-After" in res.headers

    for i in range(settings.VOLUNTEER_SIGNUP_LIMIT_PER_HOUR):
        register_volunteer(client, f"v{i}@example.test")
    body = {
        "name": "late", "email": "late@example.test", "contact_number": "1", "password": PASSWORD,
        "age": 20, "designation": "S", "gender": "F", "skills": "a", "location": "b", "availability": "c",
    }
    assert client.post("/add-volunteer", json=body).status_code == 429
