"""Tests for /api/phrases — the multi-word saved-stretch store.

Translation calls are stubbed so tests don't hit the network.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services import translate


@pytest.fixture
def stub_translate(monkeypatch: pytest.MonkeyPatch):
    """Configure translate.to_english to return a canned value."""
    calls: list[str] = []
    state: dict[str, Any] = {"result": None}

    async def fake(word: str) -> Any:
        calls.append(word)
        return state["result"]

    monkeypatch.setattr(translate, "to_english", fake)
    from app.routers import phrases as phrase_router

    monkeypatch.setattr(phrase_router.translate, "to_english", fake)
    return calls, state


def _make_song(client: TestClient, title: str = "Dopamina") -> str:
    body = {"title": title, "lyrics": "no me pises que llevo chanclas"}
    return client.post("/api/songs", json=body).json()["id"]


def test_create_captures_phrase_and_translation(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = ("don't step on me, I'm wearing sandals", "mymemory")
    song_id = _make_song(client)

    res = client.post(
        "/api/phrases",
        json={
            "text": "no me pises que llevo chanclas",
            "songId": song_id,
            "startIndex": 0,
            "endIndex": 5,
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["text"] == "no me pises que llevo chanclas"
    assert body["translation"] == "don't step on me, I'm wearing sandals"
    assert body["translationSource"] == "mymemory"
    assert body["songId"] == song_id
    assert body["songTitle"] == "Dopamina"
    assert body["startIndex"] == 0
    assert body["endIndex"] == 5


def test_no_translation_stored_empty(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client)

    res = client.post(
        "/api/phrases",
        json={"text": "foo bar", "songId": song_id, "startIndex": 0, "endIndex": 1},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["translation"] == ""
    assert body["translationSource"] == ""


def test_dedup_by_song_and_range(client: TestClient, stub_translate) -> None:
    _calls, state = stub_translate
    state["result"] = ("t", "mymemory")
    song_id = _make_song(client)

    first = client.post(
        "/api/phrases",
        json={"text": "a b", "songId": song_id, "startIndex": 0, "endIndex": 1},
    ).json()
    second = client.post(
        "/api/phrases",
        json={"text": "a b", "songId": song_id, "startIndex": 0, "endIndex": 1},
    ).json()
    assert first["id"] == second["id"]
    assert second["savedAt"] >= first["savedAt"]

    listing = client.get("/api/phrases").json()
    assert len(listing) == 1


def test_indices_are_normalized(client: TestClient, stub_translate) -> None:
    """Backwards start/end still works — the server sorts them."""
    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client)

    res = client.post(
        "/api/phrases",
        json={"text": "backwards", "songId": song_id, "startIndex": 5, "endIndex": 2},
    ).json()
    assert res["startIndex"] == 2
    assert res["endIndex"] == 5


def test_negative_index_rejected(client: TestClient) -> None:
    res = client.post(
        "/api/phrases",
        json={"text": "bad", "startIndex": -1, "endIndex": 3},
    )
    assert res.status_code == 422


def test_empty_text_rejected(client: TestClient) -> None:
    res = client.post(
        "/api/phrases",
        json={"text": "   ", "startIndex": 0, "endIndex": 1},
    )
    assert res.status_code == 422


def test_list_newest_first(client: TestClient, stub_translate) -> None:
    import time

    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client)

    for i, text in enumerate(["first", "second", "third"]):
        # saved_at is millisecond precision; sequential POSTs can collide,
        # so wait a tick to make the ordering deterministic in tests.
        time.sleep(0.002)
        client.post(
            "/api/phrases",
            json={
                "text": text,
                "songId": song_id,
                "startIndex": i,
                "endIndex": i + 1,
            },
        )

    words = [p["text"] for p in client.get("/api/phrases").json()]
    assert words == ["third", "second", "first"]


def test_delete(client: TestClient, stub_translate) -> None:
    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client)

    entry = client.post(
        "/api/phrases",
        json={"text": "adios", "songId": song_id, "startIndex": 0, "endIndex": 0},
    ).json()
    assert client.delete(f"/api/phrases/{entry['id']}").status_code == 204
    remaining = [p["id"] for p in client.get("/api/phrases").json()]
    assert entry["id"] not in remaining


def test_delete_missing_is_ok(client: TestClient) -> None:
    assert client.delete("/api/phrases/nope").status_code == 204


def test_song_delete_sets_song_id_null_but_keeps_title(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client, title="About to be deleted")

    entry = client.post(
        "/api/phrases",
        json={"text": "adios", "songId": song_id, "startIndex": 0, "endIndex": 1},
    ).json()
    assert client.delete(f"/api/songs/{song_id}").status_code == 204

    survivor = next(
        p for p in client.get("/api/phrases").json() if p["id"] == entry["id"]
    )
    assert survivor["songId"] is None
    assert survivor["songTitle"] == "About to be deleted"
    # Range indices survive so the phrase remains meaningful.
    assert survivor["startIndex"] == 0
    assert survivor["endIndex"] == 1


def test_phrase_without_song_id(client: TestClient, stub_translate) -> None:
    """Standalone phrases (no source song) are allowed for future use."""
    _calls, state = stub_translate
    state["result"] = ("hello world", "mymemory")
    res = client.post(
        "/api/phrases",
        json={"text": "hola mundo", "startIndex": 0, "endIndex": 1},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["songId"] is None
