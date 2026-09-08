"""Tests for /api/lyrics/search — the LRCLIB proxy.

We stub the module-level `search_track` so tests don't hit the network. Real
LRCLIB integration is exercised at the service layer manually if needed.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services import lrclib


@pytest.fixture
def stub_lrclib(monkeypatch: pytest.MonkeyPatch):
    """Configure lrclib.search_track to return a canned value per test."""
    calls: list[dict[str, Any]] = []
    state: dict[str, Any] = {"result": None}

    async def fake_search(**kwargs: Any) -> Any:
        calls.append(kwargs)
        return state["result"]

    monkeypatch.setattr(lrclib, "search_track", fake_search)
    # Handle also has to be patched on the imported reference in the router.
    from app.routers import lyrics as lyrics_router

    monkeypatch.setattr(lyrics_router.lrclib, "search_track", fake_search)
    return calls, state


def test_search_found(client: TestClient, stub_lrclib) -> None:
    _calls, state = stub_lrclib
    state["result"] = {
        "syncedLyrics": "[00:12.34]Casa azul",
        "plainLyrics": "Casa azul",
    }
    res = client.get(
        "/api/lyrics/search",
        params={
            "trackName": "Dopamina",
            "artistName": "Pau",
            "albumName": "X",
            "durationSec": 200,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["syncedLyrics"] == "[00:12.34]Casa azul"
    assert body["plainLyrics"] == "Casa azul"
    assert body["source"] == "lrclib"


def test_search_forwards_params(client: TestClient, stub_lrclib) -> None:
    calls, state = stub_lrclib
    state["result"] = {"syncedLyrics": "x", "plainLyrics": "x"}
    client.get(
        "/api/lyrics/search",
        params={
            "trackName": "T",
            "artistName": "A",
            "albumName": "Al",
            "durationSec": 180,
        },
    )
    assert calls == [
        {
            "track_name": "T",
            "artist_name": "A",
            "album_name": "Al",
            "duration_sec": 180,
        }
    ]


def test_search_optional_album_and_duration(
    client: TestClient, stub_lrclib
) -> None:
    calls, state = stub_lrclib
    state["result"] = {"syncedLyrics": "x", "plainLyrics": "x"}
    client.get(
        "/api/lyrics/search",
        params={"trackName": "T", "artistName": "A"},
    )
    assert calls[0]["album_name"] == ""
    assert calls[0]["duration_sec"] is None


def test_search_not_found_returns_404(
    client: TestClient, stub_lrclib
) -> None:
    _calls, state = stub_lrclib
    state["result"] = None
    res = client.get(
        "/api/lyrics/search",
        params={"trackName": "Nope", "artistName": "Nobody"},
    )
    assert res.status_code == 404


def test_search_requires_track_and_artist(client: TestClient) -> None:
    # FastAPI/Pydantic reject a missing required query param with 422.
    assert client.get("/api/lyrics/search").status_code == 422
    assert (
        client.get(
            "/api/lyrics/search", params={"trackName": "T"}
        ).status_code
        == 422
    )
