"""Shared test setup.

Everything runs against a throwaway DATA_DIR (never backend/voluntag.db):
the variables below are set BEFORE the app is imported, because settings.py
reads them once at import time. The sentence model is replaced by a small
deterministic fake encoder, and BLIP/CLIP by a fake image analysis, so the
suite needs no models and no network. Mail goes to a list (fake mailer).
"""

import hashlib
import io
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="voluntag-tests-")).resolve()

os.environ["DATA_DIR"] = str(TEST_DATA_DIR)
os.environ["SEED_DEMO_DATA"] = "false"
os.environ["MAIL_ENABLED"] = "true"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["REPORT_MISMATCH_MODE"] = "enforce"
os.environ["MATCH_V2"] = "false"
os.environ["MATCH_USE_RATINGS"] = "true"
for key in ("TRUST_PROXY_HEADERS", "APP_ENV", "ENABLE_DOCS"):
    os.environ.pop(key, None)

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import admin_auth  # noqa: E402
import database  # noqa: E402
import embedding_store  # noqa: E402
import event_rules  # noqa: E402
import issue_ai_pipeline  # noqa: E402
import login_limiter  # noqa: E402
import mailer  # noqa: E402
import main  # noqa: E402
import rate_limit  # noqa: E402
import settings  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert settings.DATABASE_PATH.parent == TEST_DATA_DIR, "tests must never use the real database"

PASSWORD = "Demo@12345"


# ─── Fakes ────────────────────────────────────────────────────────
def fake_encode(texts):
    """Bag-of-words hashing into 384 dims: same words -> similar vectors."""
    out = np.zeros((len(texts), 384), dtype=np.float32)
    for i, text in enumerate(texts):
        for word in (text or "").lower().replace(",", " ").split():
            h = int(hashlib.md5(word.encode()).hexdigest(), 16)
            out[i, h % 384] += 1.0
        norm = np.linalg.norm(out[i])
        if norm:
            out[i] /= norm
    return out


class FakeMailbox(list):
    def __call__(self, message):
        if self.fail:
            raise ConnectionRefusedError("mail server down")
        self.append(message)

    fail = False


class FakeImages:
    """Stands in for BLIP/CLIP: similarity is chosen by the test."""

    def __init__(self):
        self.similarity = 0.30
        self.calls = []

    def __call__(self, paths, description=None, base_dir=None, caption=True):
        self.calls.append({"paths": list(paths), "description": description})
        analysis = issue_ai_pipeline.ImageAnalysis(
            caption="a photo of a street", category="Environment", images_read=len(paths),
        )
        if description is not None:
            analysis.similarities = [self.similarity for _ in paths]
        return analysis


# ─── Fixtures ─────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    """Empty database, limiters and mailbox for every test."""
    database.Base.metadata.drop_all(bind=database.engine)
    for leftover in TEST_DATA_DIR.glob("voluntag.db.bak-*"):
        leftover.unlink()

    rate_limit.reset_all()
    login_limiter._state.clear()

    monkeypatch.setattr(embedding_store, "encode_texts", fake_encode)
    monkeypatch.setattr(issue_ai_pipeline, "encode_texts", fake_encode)
    yield


@pytest.fixture
def mailbox():
    box = FakeMailbox()
    mailer.set_transport(box)
    yield box
    mailer.set_transport(None)


@pytest.fixture
def fake_images(monkeypatch):
    fake = FakeImages()
    monkeypatch.setattr(main, "analyse_images", fake)
    return fake


@pytest.fixture
def client(mailbox, fake_images):
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def freeze_today(monkeypatch):
    """freeze_today("2026-11-16 05:30") sets the IST clock."""

    def _freeze(text):
        moment = datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=event_rules.IST)
        monkeypatch.setattr(event_rules, "now_ist", lambda: moment)
        return moment

    return _freeze


# ─── Helpers ──────────────────────────────────────────────────────
def png_bytes(size=(32, 32), color=(200, 30, 30), fmt="PNG"):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    return buf.getvalue()


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def register_volunteer(client, email="vol@example.test", name=None, skills="Teaching, tutoring, literacy", location="Pune, India"):
    body = {
        "name": name or email.split("@")[0],
        "email": email,
        "contact_number": "9999999999",
        "password": PASSWORD,
        "age": 25,
        "designation": "Student",
        "gender": "Female",
        "skills": skills,
        "location": location,
        "availability": "Weekends",
        "experience": "Beginner",
    }
    res = client.post("/add-volunteer", json=body)
    assert res.status_code == 200, res.text
    return body


def register_ngo(client, email="ngo@example.test", name=None, category="Education", location="Pune, India", motto="Teaching children to read"):
    data = {
        "name": name or email.split("@")[0],
        "email": email,
        "contact_number": "8888888888",
        "password": PASSWORD,
        "category": category,
        "location": location,
        "motto": motto,
        "legal_structure": "Trust",
    }
    res = client.post("/add-ngo", data=data)
    assert res.status_code == 200, res.text
    return res.json()["ngo_id"]


def login(client, role, email, password=PASSWORD):
    res = client.post(f"/{role}-login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["token"]


def db_session():
    return database.SessionLocal()


def admin_token():
    db = db_session()
    try:
        token, _ = admin_auth.create_session(db)
        db.commit()
        return token
    finally:
        db.close()
