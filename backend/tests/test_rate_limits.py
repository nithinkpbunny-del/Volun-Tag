"""Persistent limiter store, login lockout rules and the client_ip() helper."""

import sqlite3
import subprocess
import sys
import textwrap

import pytest
from starlette.requests import Request

import limit_store
import login_limiter
import rate_limit
import settings
from conftest import BACKEND_DIR, PASSWORD, TEST_DATA_DIR, login, register_volunteer


# ─── Store ────────────────────────────────────────────────────────
@pytest.fixture
def clock(monkeypatch):
    now = [1_000_000.0]
    monkeypatch.setattr(limit_store, "clock", lambda: now[0])
    return now


@pytest.fixture
def store_path():
    path = TEST_DATA_DIR / "store-test.db"
    for suffix in ("", "-wal", "-shm"):
        p = path.with_name(path.name + suffix)
        if p.exists():
            p.unlink()
    return path


def test_sliding_window_and_retry_after(store_path, clock):
    store = limit_store.LimitStore(store_path)
    assert [store.hit("b", "k", 2, 60) for _ in range(2)] == [0.0, 0.0]
    assert store.hit("b", "k", 2, 60) == pytest.approx(60)
    clock[0] += 30
    assert store.hit("b", "k", 2, 60) == pytest.approx(30)  # refused hits are not counted
    assert store.hit("b", "other", 2, 60) == 0.0             # keys are separate
    clock[0] += 31
    assert store.hit("b", "k", 2, 60) == 0.0


def test_state_survives_a_restart(store_path, clock):
    first = limit_store.LimitStore(store_path)
    first.hit("b", "k", 1, 60)
    first.lock("locks", "acct", 300)
    first.close()

    # A new store object = a restarted process reading the same file.
    second = limit_store.LimitStore(store_path)
    assert second.hit("b", "k", 1, 60) > 0
    assert second.locked_for("locks", "acct") == pytest.approx(300)


def test_keys_are_hashed_with_a_stored_salt(store_path):
    store = limit_store.LimitStore(store_path)
    store.hit("login-ip", "203.0.113.9", 5, 60)
    store.add("pair", (("volunteer", "secret@example.test"), "203.0.113.9"), 60, subject="x")
    store.close()

    raw = sqlite3.connect(store_path)
    dump = "\n".join(raw.iterdump())
    raw.close()
    assert "203.0.113.9" not in dump and "secret@example.test" not in dump
    assert limit_store.LimitStore(store_path).h("a") == store.h("a")  # same salt after restart


def test_expired_rows_are_purged(store_path, clock):
    store = limit_store.LimitStore(store_path)
    store.hit("b", "k", 5, 60)
    store.lock("l", "k", 10)
    clock[0] += 61
    assert store.purge() == 2
    assert store.row_counts() == {"hits": 0, "locks": 0}


def test_two_processes_share_one_limit(store_path):
    """Four processes race for 10 slots: exactly 10 are allowed in total."""
    script = textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(BACKEND_DIR)!r})
        from limit_store import LimitStore
        store = LimitStore({str(store_path)!r})
        print(sum(1 for _ in range(10) if store.hit("shared", "k", 10, 3600) == 0))
    """)
    procs = [
        subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, text=True)
        for _ in range(4)
    ]
    allowed = [int(p.communicate(timeout=60)[0]) for p in procs]
    assert sum(allowed) == 10


# ─── Login lockout ────────────────────────────────────────────────
def attempt(client, email, password, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post("/volunteer-login", json={"email": email, "password": password}, headers=headers)


@pytest.fixture
def proxied(monkeypatch):
    """One trusted proxy: the client address comes from X-Forwarded-For."""
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 1)


def test_lockout_is_per_account_and_ip(client, proxied):
    register_volunteer(client, "owner@example.test")

    for _ in range(settings.LOGIN_MAX_FAILURES):
        assert attempt(client, "owner@example.test", "Wrong#1234", "198.51.100.7").status_code == 401

    locked = attempt(client, "owner@example.test", PASSWORD, "198.51.100.7")
    assert locked.status_code == 429
    assert locked.json()["detail"].startswith("Too many failed logins. Try again in")
    assert int(locked.headers["Retry-After"]) > 0

    # The real owner on another network is not locked out by the stranger.
    assert attempt(client, "owner@example.test", PASSWORD, "203.0.113.20").status_code == 200


def test_lockout_answer_is_the_same_for_unknown_accounts(client, proxied):
    register_volunteer(client, "owner@example.test")
    for email in ("owner@example.test", "ghost@example.test"):
        for _ in range(settings.LOGIN_MAX_FAILURES):
            attempt(client, email, "Wrong#1234", "198.51.100.7")
    real = attempt(client, "owner@example.test", "Wrong#1234", "198.51.100.7")
    ghost = attempt(client, "ghost@example.test", "Wrong#1234", "198.51.100.7")
    assert real.status_code == ghost.status_code == 429
    assert real.json() == ghost.json()


def test_per_ip_limit_across_accounts(client, proxied, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_IP_MAX_FAILURES", 7)
    register_volunteer(client, "owner@example.test")

    for i in range(7):
        assert attempt(client, f"user{i}@example.test", "Wrong#1234", "198.51.100.7").status_code == 401

    assert attempt(client, "owner@example.test", PASSWORD, "198.51.100.7").status_code == 429
    assert attempt(client, "owner@example.test", PASSWORD, "198.51.100.8").status_code == 200


def test_account_ceiling_and_reset_clears_it(client, proxied, monkeypatch, mailbox):
    monkeypatch.setattr(settings, "LOGIN_ACCOUNT_MAX_FAILURES_PER_HOUR", 6)
    register_volunteer(client, "owner@example.test")

    for i in range(6):  # spread over many addresses, under the per-pair limit
        attempt(client, "owner@example.test", "Wrong#1234", f"198.51.100.{i}")

    assert attempt(client, "owner@example.test", PASSWORD, "203.0.113.20").status_code == 429

    login_limiter.clear_account("volunteer", "owner@example.test")
    assert attempt(client, "owner@example.test", PASSWORD, "203.0.113.20").status_code == 200


def test_correct_login_clears_only_its_own_pair(client, proxied):
    register_volunteer(client, "owner@example.test")
    for _ in range(settings.LOGIN_MAX_FAILURES - 1):
        attempt(client, "owner@example.test", "Wrong#1234", "198.51.100.7")
    assert attempt(client, "owner@example.test", PASSWORD, "198.51.100.7").status_code == 200
    # The count started again: four more failures do not lock.
    for _ in range(settings.LOGIN_MAX_FAILURES - 1):
        assert attempt(client, "owner@example.test", "Wrong#1234", "198.51.100.7").status_code == 401


def test_lockout_survives_a_restart(client, proxied):
    register_volunteer(client, "owner@example.test")
    for _ in range(settings.LOGIN_MAX_FAILURES):
        attempt(client, "owner@example.test", "Wrong#1234", "198.51.100.7")

    rate_limit.get_store().close()
    rate_limit.set_store(None)  # the next call opens the file again, like a new process
    assert attempt(client, "owner@example.test", PASSWORD, "198.51.100.7").status_code == 429


def test_spoofed_header_is_ignored_without_trust(client):
    """Default settings: X-Forwarded-For cannot move a client out of its lockout."""
    register_volunteer(client, "owner@example.test")
    for i in range(settings.LOGIN_MAX_FAILURES):
        attempt(client, "owner@example.test", "Wrong#1234", f"10.0.0.{i}")
    assert attempt(client, "owner@example.test", PASSWORD, "10.9.9.9").status_code == 429


def test_signup_limiter_is_persistent(client):
    for i in range(settings.VOLUNTEER_SIGNUP_LIMIT_PER_HOUR):
        register_volunteer(client, f"v{i}@example.test", verify=False)
    rate_limit.get_store().close()
    rate_limit.set_store(None)
    body = {
        "name": "late", "email": "late@example.test", "contact_number": "1", "password": PASSWORD,
        "age": 20, "designation": "S", "gender": "F", "skills": "a", "location": "b", "availability": "c",
    }
    assert client.post("/add-volunteer", json=body).status_code == 429


# ─── client_ip() ──────────────────────────────────────────────────
def make_request(peer="10.0.0.1", forwarded=None, proto=None, scheme="http"):
    headers = []
    for value in forwarded or []:
        headers.append((b"x-forwarded-for", value.encode()))
    if proto:
        headers.append((b"x-forwarded-proto", proto.encode()))
    return Request({
        "type": "http", "method": "GET", "path": "/", "headers": headers,
        "client": (peer, 1234), "scheme": scheme, "server": ("api", 80), "query_string": b"",
    })


def set_proxy(monkeypatch, trust, count):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", trust)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", count)


def test_client_ip_ignores_the_header_by_default(monkeypatch):
    set_proxy(monkeypatch, False, 0)
    assert rate_limit.client_ip(make_request(forwarded=["1.2.3.4"])) == "10.0.0.1"


def test_client_ip_one_proxy_uses_the_rightmost_entry(monkeypatch):
    set_proxy(monkeypatch, True, 1)
    # The client sent "6.6.6.6" itself; the proxy appended the real address.
    assert rate_limit.client_ip(make_request(forwarded=["6.6.6.6, 198.51.100.7"])) == "198.51.100.7"
    assert rate_limit.client_ip(make_request(forwarded=["198.51.100.7"])) == "198.51.100.7"


def test_client_ip_two_proxies(monkeypatch):
    set_proxy(monkeypatch, True, 2)
    # client-sent spoof, the real client (added by proxy 1), proxy 1 (added by proxy 2)
    request = make_request(forwarded=["6.6.6.6, 198.51.100.7, 10.1.1.1"])
    assert rate_limit.client_ip(request) == "198.51.100.7"
    # Repeated headers count as one list.
    request = make_request(forwarded=["6.6.6.6", "198.51.100.7, 10.1.1.1"])
    assert rate_limit.client_ip(request) == "198.51.100.7"


def test_client_ip_falls_back_to_the_peer(monkeypatch):
    set_proxy(monkeypatch, True, 2)
    assert rate_limit.client_ip(make_request(forwarded=["198.51.100.7"])) == "10.0.0.1"  # too short
    assert rate_limit.client_ip(make_request()) == "10.0.0.1"
    set_proxy(monkeypatch, True, 1)
    assert rate_limit.client_ip(make_request(forwarded=["1.1.1.1, not-an-ip"])) == "10.0.0.1"


def test_client_ip_ports_and_ipv6(monkeypatch):
    set_proxy(monkeypatch, True, 1)
    assert rate_limit.client_ip(make_request(forwarded=["198.51.100.7:4321"])) == "198.51.100.7"
    assert rate_limit.client_ip(make_request(forwarded=["[2001:db8::1]:443"])) == "2001:db8::1"
    assert rate_limit.client_ip(make_request(forwarded=["2001:DB8::1"])) == "2001:db8::1"


def test_trust_with_zero_count_means_one(monkeypatch):
    set_proxy(monkeypatch, True, 0)
    assert rate_limit.client_ip(make_request(forwarded=["6.6.6.6, 198.51.100.7"])) == "198.51.100.7"
