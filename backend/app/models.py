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
    # Cached album cover URL from Spotify's CDN (i.scdn.co). Populated by the
    # frontend after save using the user's Spotify token, so the backend
    # doesn't need Spotify credentials of its own.
    album_art_url: str = ""
    # Synchronized lyrics in raw LRC format when available (from lrclib.net).
    # Empty string means "we haven't found timed lyrics for this song";
    # rendering falls back to the plain `lyrics` field.
    synced_lyrics: str = ""
    # Where `synced_lyrics` came from: currently "lrclib" or "" if manually
    # entered / not sourced externally. Lets us show attribution and, later,
    # re-fetch when we add other providers.
    lyrics_source: str = ""


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


# --- Dictionary (word lookups) ---
# Every 📖 lookup in Practice inserts (or refreshes) a row here. The
# `song_title` denormalization keeps the entry meaningful after the source
# song is deleted; the FK is `SET NULL` for the same reason.


class WordLookupBase(SQLModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    # Normalized form: lowercased + trimmed; accents preserved so `canción`
    # and `cancion` remain distinct vocabulary entries (the user is
    # explicitly training on accents).
    word: str
    # Original casing/accents from the song, for display.
    display: str = ""
    # Best-effort translation; empty when we couldn't fetch or the provider
    # returned nothing usable. `translation_source` names the provider.
    translation: str = ""
    translation_source: str = ""
    # Nullable so an entry survives its source song being deleted.
    song_id: str | None = Field(
        default=None,
        foreign_key="song.id",
        ondelete="SET NULL",
    )
    # Snapshot at creation time; the UI shows this even if `song_id` is now
    # NULL because the song was removed.
    song_title: str = ""


class WordLookup(WordLookupBase, table=True):
    __tablename__ = "word_lookup"
    id: str = Field(primary_key=True)
    looked_up_at: int = Field(default_factory=_now_ms)


class WordLookupCreate(SQLModel):
    """POST body: minimal fields the client sends. Backend fills the rest."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    word: str
    display: str = ""
    song_id: str | None = None


class WordLookupRead(WordLookupBase):
    id: str
    looked_up_at: int


# --- Phrases (multi-word saved stretches) ---
# Parallels WordLookup but stores a range of word indices so a saved phrase
# can later jump playback to its start timestamp when synced lyrics exist.


class PhraseLookupBase(SQLModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    # The phrase as it appears in the song (whitespace-collapsed).
    text: str
    translation: str = ""
    translation_source: str = ""  # "mymemory" | ""
    # Same SET NULL + song_title snapshot pattern as WordLookup so a saved
    # phrase survives its source song being deleted.
    song_id: str | None = Field(
        default=None,
        foreign_key="song.id",
        ondelete="SET NULL",
    )
    song_title: str = ""
    # Word-index range within the song. Inclusive on both ends. Kept even
    # after `song_id` is nulled so we still know where in the (now-deleted)
    # song this came from.
    start_index: int
    end_index: int


class PhraseLookup(PhraseLookupBase, table=True):
    __tablename__ = "phrase_lookup"
    id: str = Field(primary_key=True)
    saved_at: int = Field(default_factory=_now_ms)


class PhraseLookupCreate(SQLModel):
    """POST body: minimal fields the client sends. Backend fills the rest."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    text: str
    song_id: str | None = None
    start_index: int
    end_index: int


class PhraseLookupRead(PhraseLookupBase):
    id: str
    saved_at: int
