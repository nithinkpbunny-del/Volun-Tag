"""Security headers on every API response."""

import settings
from conftest import register_volunteer

API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


def check_common(res):
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "no-referrer"
    assert "camera=()" in res.headers["permissions-policy"]


def test_headers_on_json_errors_and_preflight(client):
    for res in (
        client.get("/health"),
        client.get("/no-such-page"),
        client.post("/volunteer-login", json={"email": "x@example.test", "password": "y"}),
        client.options(
            "/volunteer-login",
            headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
        ),
    ):
        check_common(res)
        assert res.headers["content-security-policy"] == API_CSP
        assert "strict-transport-security" not in res.headers  # plain http


def test_headers_on_rate_limit_and_size_errors(client, monkeypatch):
    import main
    monkeypatch.setattr(main, "MAX_REQUEST_BYTES", 10)
    res = client.post("/add-ngo", content=b"x" * 100, headers={"Content-Type": "application/octet-stream"})
    assert res.status_code == 413
    check_common(res)


def test_hsts_only_over_https(client, monkeypatch):
    https = client.get("/health", headers={"X-Forwarded-Proto": "https"})
    assert "strict-transport-security" not in https.headers  # proxy headers not trusted

    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 1)
    https = client.get("/health", headers={"X-Forwarded-Proto": "https"})
    assert https.headers["strict-transport-security"].startswith("max-age=")
    plain = client.get("/health", headers={"X-Forwarded-Proto": "http"})
    assert "strict-transport-security" not in plain.headers


def test_hsts_on_a_direct_https_request():
    from fastapi.testclient import TestClient
    import main
    with TestClient(main.app, base_url="https://testserver") as c:
        assert c.get("/health").headers["strict-transport-security"].startswith("max-age=31536000")


def test_docs_pages_keep_working_without_the_api_csp(client):
    if not settings.ENABLE_DOCS:
        return
    res = client.get("/docs")
    assert res.status_code == 200
    assert "content-security-policy" not in res.headers
    check_common(res)
