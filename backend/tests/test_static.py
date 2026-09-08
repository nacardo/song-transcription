"""Tests for the static-file + SPA fallback wiring in main.py.

We build a minimal `static/` directory in a tmp path, point the settings at
it, then import a fresh copy of the app module so the conditional
route-registration runs against our stub filesystem.
"""

from __future__ import annotations

import importlib
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings as app_settings
from app.db import enable_sqlite_foreign_keys, get_session
from app.deps import require_auth


def _make_static_dir(root: Path) -> Path:
    static = root / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text(
        "<!doctype html><title>SPA</title>", encoding="utf-8"
    )
    (static / "favicon.ico").write_bytes(b"\x00\x01\x02")
    (static / "assets" / "index-abc.js").write_text(
        "console.log('spa');", encoding="utf-8"
    )
    return static


@pytest.fixture
def static_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[TestClient, None, None]:
    """Rebuild the FastAPI app with static_dir pointing at a tmp directory."""
    static = _make_static_dir(tmp_path)
    monkeypatch.setattr(app_settings, "static_dir", str(static))

    # Re-import so the module-level `if app_settings.static_dir:` branch runs.
    import app.main

    app_module = importlib.reload(app.main)

    # Wire the same in-memory DB + bypass-auth overrides the normal
    # `client` fixture uses, so this test file is self-contained.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    enable_sqlite_foreign_keys(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as sess:
        def _get() -> Generator[Session, None, None]:
            yield sess

        app_module.app.dependency_overrides[get_session] = _get
        app_module.app.dependency_overrides[require_auth] = lambda: None
        with TestClient(app_module.app) as c:
            yield c
        app_module.app.dependency_overrides.clear()

    # Restore the app for downstream tests by reloading once more without
    # the static_dir override (monkeypatch has already reset it).
    importlib.reload(app.main)


def test_root_serves_index(static_client: TestClient) -> None:
    res = static_client.get("/")
    assert res.status_code == 200
    assert "SPA" in res.text


def test_unknown_client_route_serves_index(static_client: TestClient) -> None:
    # /callback is the Spotify OAuth landing — a client-side route.
    res = static_client.get("/callback?code=abc&state=xyz")
    assert res.status_code == 200
    assert "SPA" in res.text


def test_top_level_file_is_served_directly(static_client: TestClient) -> None:
    res = static_client.get("/favicon.ico")
    assert res.status_code == 200
    assert res.content == b"\x00\x01\x02"


def test_hashed_asset_is_served(static_client: TestClient) -> None:
    res = static_client.get("/assets/index-abc.js")
    assert res.status_code == 200
    assert "console.log" in res.text


def test_api_health_still_works(static_client: TestClient) -> None:
    res = static_client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_unknown_api_route_404s(static_client: TestClient) -> None:
    # Must NOT fall through to index.html — a bogus /api call should error
    # like normal, otherwise fetch() in the frontend silently gets HTML back.
    res = static_client.get("/api/nope")
    assert res.status_code == 404


def test_path_traversal_is_blocked(static_client: TestClient) -> None:
    # Contrived: FastAPI/Starlette already normalizes many of these before
    # our handler sees them, but the resolve()+relative_to() guard is our
    # backstop against anything that slips through.
    res = static_client.get("/../etc/passwd")
    # Either a 404 (normalized away) or handled by our guard — never a 200
    # with the file contents.
    assert res.status_code in (200, 404)
    if res.status_code == 200:
        assert "SPA" in res.text  # fell back to index.html, not the file
