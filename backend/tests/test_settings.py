from fastapi.testclient import TestClient


def test_get_returns_defaults_when_unset(client: TestClient) -> None:
    res = client.get("/api/settings")
    assert res.status_code == 200
    assert res.json() == {
        "requireAccents": False,
        "rewindOnResumeSeconds": 2,
    }


def test_patch_single_field(client: TestClient) -> None:
    res = client.patch("/api/settings", json={"requireAccents": True})
    assert res.status_code == 200
    assert res.json() == {
        "requireAccents": True,
        "rewindOnResumeSeconds": 2,
    }
    # Persists across a fresh GET.
    assert client.get("/api/settings").json()["requireAccents"] is True


def test_patch_multiple_fields(client: TestClient) -> None:
    res = client.patch(
        "/api/settings",
        json={"requireAccents": True, "rewindOnResumeSeconds": 4},
    )
    assert res.json() == {
        "requireAccents": True,
        "rewindOnResumeSeconds": 4,
    }


def test_patch_preserves_omitted(client: TestClient) -> None:
    """Omitted fields keep their value — omitting is NOT the same as reset."""
    client.patch(
        "/api/settings",
        json={"requireAccents": True, "rewindOnResumeSeconds": 4},
    )
    res = client.patch("/api/settings", json={"requireAccents": False})
    assert res.json() == {
        "requireAccents": False,
        "rewindOnResumeSeconds": 4,
    }


def test_empty_patch_is_noop(client: TestClient) -> None:
    """A PATCH with no fields returns current values unchanged."""
    client.patch("/api/settings", json={"requireAccents": True})
    res = client.patch("/api/settings", json={})
    assert res.json()["requireAccents"] is True
