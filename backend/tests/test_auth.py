import pytest
from fastapi.testclient import TestClient

from app.config import settings as app_settings


def test_session_unauthed_by_default(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/session").json() == {"authed": False}


def test_protected_route_returns_401_when_unauthed(
    unauthed_client: TestClient,
) -> None:
    assert unauthed_client.get("/api/songs").status_code == 401
    assert unauthed_client.get("/api/settings").status_code == 401
    assert unauthed_client.get("/api/progress/x").status_code == 401


def test_login_wrong_password(unauthed_client: TestClient) -> None:
    res = unauthed_client.post("/api/login", json={"password": "nope"})
    assert res.status_code == 401
    assert unauthed_client.get("/api/session").json() == {"authed": False}


def test_login_success_grants_access(unauthed_client: TestClient) -> None:
    res = unauthed_client.post("/api/login", json={"password": "test-pass"})
    assert res.status_code == 200
    assert res.json() == {"authed": True}
    # Session cookie persists across requests on the TestClient.
    assert unauthed_client.get("/api/session").json() == {"authed": True}
    # And previously-protected routes now work.
    assert unauthed_client.get("/api/songs").status_code == 200


def test_logout_clears_session(unauthed_client: TestClient) -> None:
    unauthed_client.post("/api/login", json={"password": "test-pass"})
    assert unauthed_client.post("/api/logout").status_code == 204
    assert unauthed_client.get("/api/session").json() == {"authed": False}
    assert unauthed_client.get("/api/songs").status_code == 401


def test_login_refuses_when_password_unset(
    session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A server without APP_PASSWORD configured shouldn't authenticate anyone,
    even with the empty string. Prevents accidentally-open deployments."""
    from app.db import get_session
    from app.main import app

    monkeypatch.setattr(app_settings, "app_password", "")
    app.dependency_overrides[get_session] = lambda: iter([session])
    try:
        with TestClient(app) as c:
            res = c.post("/api/login", json={"password": ""})
            assert res.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_health_is_public(unauthed_client: TestClient) -> None:
    # Health check stays reachable without a session so ops can probe it.
    assert unauthed_client.get("/api/health").status_code == 200
