from fastapi.testclient import TestClient


def _payload(**overrides) -> dict:
    body = {
        "title": "Dopamina",
        "artist": "Pau",
        "lyrics": "[Coro]\nCasa azul",
        "spotifyUri": "spotify:track:abc",
    }
    body.update(overrides)
    return body


def test_list_empty(client: TestClient) -> None:
    res = client.get("/api/songs")
    assert res.status_code == 200
    assert res.json() == []


def test_create_and_list(client: TestClient) -> None:
    res = client.post("/api/songs", json=_payload())
    assert res.status_code == 201
    song = res.json()
    # Response should use camelCase and echo input fields.
    assert song["title"] == "Dopamina"
    assert song["artist"] == "Pau"
    assert song["lyrics"] == "[Coro]\nCasa azul"
    assert song["spotifyUri"] == "spotify:track:abc"
    # Server-populated fields
    assert isinstance(song["id"], str) and len(song["id"]) > 0
    assert isinstance(song["createdAt"], int)
    assert isinstance(song["updatedAt"], int)
    assert song["createdAt"] == song["updatedAt"]

    listing = client.get("/api/songs").json()
    assert len(listing) == 1
    assert listing[0]["id"] == song["id"]


def test_get_single(client: TestClient) -> None:
    created = client.post("/api/songs", json=_payload()).json()
    res = client.get(f"/api/songs/{created['id']}")
    assert res.status_code == 200
    assert res.json()["id"] == created["id"]


def test_get_missing_returns_404(client: TestClient) -> None:
    assert client.get("/api/songs/nope").status_code == 404


def test_put_updates_existing(client: TestClient) -> None:
    created = client.post("/api/songs", json=_payload()).json()
    original_created = created["createdAt"]
    res = client.put(
        f"/api/songs/{created['id']}",
        json=_payload(title="Nuevo título", artist="Otro"),
    )
    assert res.status_code == 200
    updated = res.json()
    assert updated["title"] == "Nuevo título"
    assert updated["artist"] == "Otro"
    # createdAt preserved; updatedAt refreshed.
    assert updated["createdAt"] == original_created
    assert updated["updatedAt"] >= original_created


def test_put_upserts_new_id(client: TestClient) -> None:
    """PUT with an id that doesn't exist creates the record — used by the
    localStorage → backend migration to keep frontend-generated ids."""
    res = client.put(
        "/api/songs/legacy-abc",
        json=_payload(
            createdAt=1000,
            updatedAt=1000,
        ),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "legacy-abc"
    # Migration-supplied timestamps are honored.
    assert body["createdAt"] == 1000
    assert body["updatedAt"] == 1000


def test_delete(client: TestClient) -> None:
    created = client.post("/api/songs", json=_payload()).json()
    res = client.delete(f"/api/songs/{created['id']}")
    assert res.status_code == 204
    assert client.get(f"/api/songs/{created['id']}").status_code == 404


def test_delete_missing_is_ok(client: TestClient) -> None:
    # Idempotent: deleting a missing id is not an error (frontend fires
    # DELETE optimistically after a confirm dialog).
    assert client.delete("/api/songs/nope").status_code == 204


def test_defaults_populated(client: TestClient) -> None:
    """artist, spotifyUri and albumArtUrl are optional; omitting them yields empty strings."""
    res = client.post(
        "/api/songs",
        json={"title": "T", "lyrics": "L"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["artist"] == ""
    assert body["spotifyUri"] == ""
    assert body["albumArtUrl"] == ""


def test_album_art_url_round_trips(client: TestClient) -> None:
    """The frontend enrichment path PUTs the fetched cover URL back; make sure
    the field is accepted, stored, and echoed."""
    art = "https://i.scdn.co/image/ab67616d0000b273abcdef"
    created = client.post(
        "/api/songs",
        json=_payload(albumArtUrl=art),
    ).json()
    assert created["albumArtUrl"] == art
    fetched = client.get(f"/api/songs/{created['id']}").json()
    assert fetched["albumArtUrl"] == art


def test_list_ordered_by_updated_desc(client: TestClient) -> None:
    client.put("/api/songs/a", json=_payload(title="A", updatedAt=1000))
    client.put("/api/songs/b", json=_payload(title="B", updatedAt=3000))
    client.put("/api/songs/c", json=_payload(title="C", updatedAt=2000))
    ids = [s["id"] for s in client.get("/api/songs").json()]
    assert ids == ["b", "c", "a"]
