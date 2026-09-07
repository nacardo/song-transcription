from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.db import enable_sqlite_foreign_keys, get_session
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


@pytest.fixture
def client(session: Session) -> Generator[TestClient, None, None]:
    """FastAPI TestClient wired to the isolated test session."""

    def _override() -> Generator[Session, None, None]:
        yield session

    app.dependency_overrides[get_session] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
