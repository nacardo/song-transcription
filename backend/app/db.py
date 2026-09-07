from collections.abc import Generator

from sqlalchemy import Engine, event
from sqlmodel import Session, SQLModel, create_engine

from .config import ensure_data_dir, settings


def enable_sqlite_foreign_keys(engine: Engine) -> None:
    """SQLite doesn't enforce foreign keys by default; needed so cascade
    deletes (song → progress) actually happen. Applied to both the runtime
    engine and the per-test engine so behavior matches."""

    @event.listens_for(engine, "connect")
    def _(dbapi_conn, _record) -> None:  # pragma: no cover - trivial
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


# check_same_thread=False lets a single SQLite connection be reused across
# FastAPI's threaded request handlers. Fine for our single-user case.
_engine_kwargs = {}
if settings.database_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.database_url, echo=False, **_engine_kwargs)

if settings.database_url.startswith("sqlite"):
    enable_sqlite_foreign_keys(engine)


def init_db() -> None:
    """Create tables from all imported SQLModel classes."""
    ensure_data_dir()
    # Importing models here ensures they're registered on SQLModel.metadata
    # before create_all runs. Additional model modules should be imported too.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a per-request session."""
    with Session(engine) as session:
        yield session
