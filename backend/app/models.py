import time

from pydantic import ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def _now_ms() -> int:
    return int(time.time() * 1000)


# --- Songs ---
# Base carries the "user-editable" fields shared by table + payload + read.
# Table uses snake_case columns in SQLite; alias_generator=to_camel exposes
# camelCase over the wire so the frontend TypeScript shape stays unchanged.


class SongBase(SQLModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    title: str
    artist: str = ""
    lyrics: str
    spotify_uri: str = ""


class Song(SongBase, table=True):
    id: str = Field(primary_key=True)
    created_at: int = Field(default_factory=_now_ms)
    updated_at: int = Field(default_factory=_now_ms)


class SongPayload(SongBase):
    """Client → server body for create (POST) or upsert (PUT).

    Timestamps are only accepted here for one-time migration; regular
    saves let the server set them.
    """

    created_at: int | None = None
    updated_at: int | None = None


class SongRead(SongBase):
    id: str
    created_at: int
    updated_at: int


# --- Progress ---
# One row per song. `answers` and `revealed` are stored as JSON blobs — that's
# enough for the current UI. If we later add per-word analytics, attempts get
# broken out into their own event table (see the backend-analytics memory).


class ProgressBase(SQLModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    # Keys are word indices, serialized as JSON strings on the wire.
    answers: dict[str, str] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    revealed: list[int] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    position_ms: int | None = None


class Progress(ProgressBase, table=True):
    song_id: str = Field(
        primary_key=True,
        foreign_key="song.id",
        ondelete="CASCADE",
    )
    updated_at: int = Field(default_factory=_now_ms)


class ProgressPayload(ProgressBase):
    pass


class ProgressRead(ProgressBase):
    updated_at: int


# --- Settings ---
# Single-row table; the row is created on first write. GETs return defaults
# before then, so the frontend never has to special-case "no settings yet".


class SettingsBase(SQLModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    require_accents: bool = False
    rewind_on_resume_seconds: int = 2


class AppSettings(SettingsBase, table=True):
    __tablename__ = "app_settings"
    id: int = Field(default=1, primary_key=True)


class SettingsPatch(SQLModel):
    """PATCH body: every field optional so callers only send what they change."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    require_accents: bool | None = None
    rewind_on_resume_seconds: int | None = None


class SettingsRead(SettingsBase):
    pass
