from collections.abc import Generator

from sqlmodel import Session, SQLModel, create_engine

from .config import ensure_data_dir, settings

# check_same_thread=False lets a single SQLite connection be reused across
# FastAPI's threaded request handlers. Fine for our single-user case.
_engine_kwargs = {}
if settings.database_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.database_url, echo=False, **_engine_kwargs)


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
