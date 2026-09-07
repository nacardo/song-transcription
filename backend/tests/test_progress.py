from fastapi.testclient import TestClient


def _make_song(client: TestClient, song_id: str = "song-1") -> str:
    res = client.put(
        f"/api/songs/{song_id}",
        json={"title": "T", "lyrics": "L"},
    )
    assert res.status_code == 200
    return res.json()["id"]


def test_get_missing_returns_404(client: TestClient) -> None:
    _make_song(client)
    assert client.get("/api/progress/song-1").status_code == 404


def test_put_orphan_song_rejected(client: TestClient) -> None:
    """Progress for a song that doesn't exist is a 404, not a silent orphan row."""
    res = client.put(
        "/api/progress/no-such-song",
        json={"answers": {"0": "hola"}, "revealed": []},
    )
    assert res.status_code == 404


def test_put_creates_and_get_returns_it(client: TestClient) -> None:
    _make_song(client)
    body = {
        "answers": {"0": "casa", "2": "azul"},
        "revealed": [1, 3],
        "positionMs": 45000,
    }
    put_res = client.put("/api/progress/song-1", json=body)
    assert put_res.status_code == 200
    got = client.get("/api/progress/song-1").json()
    assert got["answers"] == body["answers"]
    assert got["revealed"] == body["revealed"]
    assert got["positionMs"] == 45000
    assert isinstance(got["updatedAt"], int)


def test_put_replaces_existing(client: TestClient) -> None:
    _make_song(client)
    client.put(
        "/api/progress/song-1",
        json={"answers": {"0": "old"}, "revealed": [1]},
    )
    client.put(
        "/api/progress/song-1",
        json={"answers": {"0": "new"}, "revealed": []},
    )
    got = client.get("/api/progress/song-1").json()
    assert got["answers"] == {"0": "new"}
    assert got["revealed"] == []


def test_delete_clears(client: TestClient) -> None:
    _make_song(client)
    client.put(
        "/api/progress/song-1",
        json={"answers": {"0": "x"}, "revealed": []},
    )
    assert client.delete("/api/progress/song-1").status_code == 204
    assert client.get("/api/progress/song-1").status_code == 404


def test_delete_missing_is_ok(client: TestClient) -> None:
    _make_song(client)
    assert client.delete("/api/progress/song-1").status_code == 204


def test_deleting_song_cascades_progress(client: TestClient) -> None:
    """When a song is deleted, its progress row goes with it (FK cascade)."""
    _make_song(client)
    client.put(
        "/api/progress/song-1",
        json={"answers": {"0": "hola"}, "revealed": []},
    )
    assert client.get("/api/progress/song-1").status_code == 200
    assert client.delete("/api/songs/song-1").status_code == 204
    assert client.get("/api/progress/song-1").status_code == 404


def test_defaults_when_fields_omitted(client: TestClient) -> None:
    _make_song(client)
    res = client.put("/api/progress/song-1", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["answers"] == {}
    assert body["revealed"] == []
    assert body["positionMs"] is None
