import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlmodel import Session, select

from ..db import get_session
from ..deps import require_auth
from ..models import Progress, ProgressPayload, ProgressRead, Song

router = APIRouter(
    prefix="/api/progress",
    tags=["progress"],
    dependencies=[Depends(require_auth)],
)


def _now_ms() -> int:
    return int(time.time() * 1000)


class ProgressWithSongId(ProgressRead):
    """List-all response row — adds songId so callers can join back to Song
    without a second round-trip. The single-song GET below returns the song
    id via the URL path, so it doesn't need this."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    song_id: str


@router.get(
    "",
    response_model=list[ProgressWithSongId],
    response_model_by_alias=True,
)
def list_progress(
    session: Session = Depends(get_session),
) -> list[Progress]:
    """All progress rows, one per song that has any. Metrics view uses this
    to compute totals across the whole library in a single call."""
    return list(session.exec(select(Progress)).all())


@router.get(
    "/{song_id}",
    response_model=ProgressRead,
    response_model_by_alias=True,
)
def get_progress(
    song_id: str,
    session: Session = Depends(get_session),
) -> Progress:
    p = session.get(Progress, song_id)
    if p is None:
        raise HTTPException(status_code=404, detail="No progress for this song")
    return p


@router.put(
    "/{song_id}",
    response_model=ProgressRead,
    response_model_by_alias=True,
)
def upsert_progress(
    song_id: str,
    payload: ProgressPayload,
    session: Session = Depends(get_session),
) -> Progress:
    # Enforce the song exists so we don't accidentally store orphan progress.
    if session.get(Song, song_id) is None:
        raise HTTPException(status_code=404, detail="Song not found")
    now = _now_ms()
    fields = payload.model_dump()
    p = session.get(Progress, song_id)
    if p is None:
        p = Progress(song_id=song_id, updated_at=now, **fields)
    else:
        for k, v in fields.items():
            setattr(p, k, v)
        p.updated_at = now
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def clear_progress(
    song_id: str,
    session: Session = Depends(get_session),
) -> None:
    p = session.get(Progress, song_id)
    if p is not None:
        session.delete(p)
        session.commit()
