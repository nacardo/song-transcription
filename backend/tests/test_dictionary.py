"""Tests for /api/dictionary — the word-lookup store + translation proxy.

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
    # Router imports the module, so patch the router's binding too.
    from app.routers import dictionary as dict_router

    monkeypatch.setattr(dict_router.translate, "to_english", fake)
    return calls, state


def _make_song(client: TestClient, title: str = "Dopamina") -> str:
    body = {"title": title, "lyrics": "hola mundo"}
    return client.post("/api/songs", json=body).json()["id"]


def test_create_captures_word_and_translation(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = ("dopamine", "mymemory")
    song_id = _make_song(client)

    res = client.post(
        "/api/dictionary",
        json={"word": "Dopamina", "display": "Dopamina", "songId": song_id},
    )
    assert res.status_code == 201
    body = res.json()
    # Word gets normalized (lowercased, trimmed) but accents preserved.
    assert body["word"] == "dopamina"
    assert body["display"] == "Dopamina"
    assert body["translation"] == "dopamine"
    assert body["translationSource"] == "mymemory"
    assert body["songId"] == song_id
    # song_title snapshot for post-delete survival.
    assert body["songTitle"] == "Dopamina"


def test_no_translation_is_stored_empty(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = None  # provider returned nothing usable
    song_id = _make_song(client)

    res = client.post(
        "/api/dictionary",
        json={"word": "foo", "songId": song_id},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["translation"] == ""
    assert body["translationSource"] == ""


def test_repeat_lookup_same_song_bumps_instead_of_duplicating(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = ("dopamine", "mymemory")
    song_id = _make_song(client)

    first = client.post(
        "/api/dictionary",
        json={"word": "dopamina", "songId": song_id},
    ).json()
    second = client.post(
        "/api/dictionary",
        json={"word": "dopamina", "songId": song_id},
    ).json()

    assert first["id"] == second["id"]
    # The second call refreshes looked_up_at (may be same tick, but not earlier).
    assert second["lookedUpAt"] >= first["lookedUpAt"]
    # And only one row exists total.
    listing = client.get("/api/dictionary").json()
    assert len([e for e in listing if e["word"] == "dopamina"]) == 1


def test_same_word_different_songs_are_distinct(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = ("dopamine", "mymemory")
    song_a = _make_song(client, title="Song A")
    song_b = _make_song(client, title="Song B")

    a = client.post(
        "/api/dictionary",
        json={"word": "dopamina", "songId": song_a},
    ).json()
    b = client.post(
        "/api/dictionary",
        json={"word": "dopamina", "songId": song_b},
    ).json()
    assert a["id"] != b["id"]
    assert {a["songTitle"], b["songTitle"]} == {"Song A", "Song B"}


def test_list_newest_first(client: TestClient, stub_translate) -> None:
    import time

    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client)

    for w in ("uno", "dos", "tres"):
        # looked_up_at is millisecond precision; sequential POSTs can
        # collide, so wait a tick for deterministic ordering.
        time.sleep(0.002)
        client.post("/api/dictionary", json={"word": w, "songId": song_id})

    words = [e["word"] for e in client.get("/api/dictionary").json()]
    assert words == ["tres", "dos", "uno"]


def test_delete(client: TestClient, stub_translate) -> None:
    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client)

    entry = client.post(
        "/api/dictionary", json={"word": "adios", "songId": song_id}
    ).json()
    assert client.delete(f"/api/dictionary/{entry['id']}").status_code == 204
    remaining = [e["id"] for e in client.get("/api/dictionary").json()]
    assert entry["id"] not in remaining


def test_delete_missing_is_ok(client: TestClient) -> None:
    # Idempotent — the frontend fires DELETE optimistically.
    assert client.delete("/api/dictionary/nope").status_code == 204


def test_song_delete_sets_song_id_null_but_keeps_title(
    client: TestClient, stub_translate
) -> None:
    _calls, state = stub_translate
    state["result"] = None
    song_id = _make_song(client, title="About to be deleted")

    entry = client.post(
        "/api/dictionary", json={"word": "adios", "songId": song_id}
    ).json()
    assert client.delete(f"/api/songs/{song_id}").status_code == 204

    listing = client.get("/api/dictionary").json()
    survivor = next(e for e in listing if e["id"] == entry["id"])
    # FK went to NULL; title snapshot survives so the UI still shows source.
    assert survivor["songId"] is None
    assert survivor["songTitle"] == "About to be deleted"


def test_word_without_song_id(client: TestClient, stub_translate) -> None:
    """Standalone lookups (no source song) are allowed for future phases."""
    _calls, state = stub_translate
    state["result"] = ("hello", "mymemory")
    res = client.post("/api/dictionary", json={"word": "hola"})
    assert res.status_code == 201
    body = res.json()
    assert body["songId"] is None
    assert body["songTitle"] == ""


def test_empty_word_is_rejected(client: TestClient) -> None:
    res = client.post("/api/dictionary", json={"word": "   "})
    assert res.status_code == 422
