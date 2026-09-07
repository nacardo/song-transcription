import time

from pydantic import ConfigDict
from pydantic.alias_generators import to_camel
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
