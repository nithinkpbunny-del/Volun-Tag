"""Characterisation tests: registration, login, lockout, sessions."""

from conftest import PASSWORD, auth, login, register_ngo, register_volunteer


def test_volunteer_login_and_session(client):
    register_volunteer(client, "Ana@Example.test")
    token = login(client, "volunteer", "ana@example.test")

    res = client.get("/session", headers=auth(token))
    assert res.status_code == 200
    assert res.json() == {"role": "volunteer", "email": "ana@example.test"}


def test_registration_lowercases_and_checks_email(client):
    register_volunteer(client, "  MiXeD@Example.TEST ")
    login(client, "volunteer", "mixed@example.test")

    bad = client.post("/add-volunteer", json={
        "name": "x", "email": "not-an-email", "contact_number": "1", "password": PASSWORD,
        "age": 20, "designation": "S", "gender": "F", "skills": "a", "location": "b",
        "availability": "c",
    })
    assert bad.status_code == 422


def test_wrong_password_then_lockout(client):
    register_volunteer(client, "lock@example.test")
    for _ in range(5):
        res = client.post("/volunteer-login", json={"email": "lock@example.test", "password": "Wrong@12345"})
        assert res.status_code in (401, 429)
    res = client.post("/volunteer-login", json={"email": "lock@example.test", "password": PASSWORD})
    assert res.status_code == 429


def test_unknown_email_same_401(client):
    res = client.post("/volunteer-login", json={"email": "nobody@example.test", "password": PASSWORD})
    assert res.status_code == 401
    assert res.json()["detail"] == "Incorrect email or password"


def test_logout_ends_session(client):
    register_ngo(client, "org@example.test")
    token = login(client, "ngo", "org@example.test")
    assert client.post("/logout", headers=auth(token)).status_code == 200
    assert client.get("/session", headers=auth(token)).status_code == 401


def test_duplicate_email_rejected(client):
    register_volunteer(client, "dup@example.test", name="First")
    body = {
        "name": "Second", "email": "DUP@example.test", "contact_number": "1", "password": PASSWORD,
        "age": 20, "designation": "S", "gender": "F", "skills": "a", "location": "b",
        "availability": "c",
    }
    assert client.post("/add-volunteer", json=body).status_code == 400
