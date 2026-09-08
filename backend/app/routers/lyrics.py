from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from ..deps import require_auth
from ..services import lrclib

router = APIRouter(
    prefix="/api/lyrics",
    tags=["lyrics"],
    dependencies=[Depends(require_auth)],
)


class LyricsSearchResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    synced_lyrics: str
    plain_lyrics: str
    source: str  # "lrclib" for now


@router.get(
    "/search",
    response_model=LyricsSearchResponse,
    response_model_by_alias=True,
)
async def search(
    track_name: str = Query(..., alias="trackName", min_length=1),
    artist_name: str = Query(..., alias="artistName", min_length=1),
    album_name: str = Query("", alias="albumName"),
    duration_sec: int | None = Query(None, alias="durationSec", ge=1),
) -> LyricsSearchResponse:
    """Look up lyrics for a Spotify track. 404 when nothing usable is found —
    the frontend treats that as "no synced lyrics available, keep asking the
    user to paste their own"."""
    result = await lrclib.search_track(
        track_name=track_name,
        artist_name=artist_name,
        album_name=album_name,
        duration_sec=duration_sec,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Lyrics not found")
    return LyricsSearchResponse(
        synced_lyrics=result["syncedLyrics"],
        plain_lyrics=result["plainLyrics"],
        source="lrclib",
    )
