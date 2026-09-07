from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings as app_settings
from app.db import enable_sqlite_foreign_keys, get_session
from app.deps import require_auth
from app.main import app


@pytest.fixture
def session() -> Generator[Session, None, None]:
    """Fresh in-memory SQLite per test.

    StaticPool + single connection means all sessions in the test share the
    same underlying DB, so a session in the fixture and a session inside a
    request handler see the same data.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    enable_sqlite_foreign_keys(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as sess:
        yield sess


def _override_session_factory(session: Session):
    def _get() -> Generator[Session, None, None]:
        yield session

    return _get


@pytest.fixture
def client(session: Session) -> Generator[TestClient, None, None]:
    """TestClient with auth bypassed — the default for feature tests."""
    app.dependency_overrides[get_session] = _override_session_factory(session)
    app.dependency_overrides[require_auth] = lambda: None
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def unauthed_client(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    """TestClient with the real auth dep in place — for testing login itself.

    Sets a known password so the login flow can succeed in tests without
    depending on the developer's real .env.
    """
    monkeypatch.setattr(app_settings, "app_password", "test-pass")
    app.dependency_overrides[get_session] = _override_session_factory(session)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
