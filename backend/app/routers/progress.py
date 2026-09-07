import time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from ..db import get_session
from ..models import Progress, ProgressPayload, ProgressRead, Song

router = APIRouter(prefix="/api/progress", tags=["progress"])


def _now_ms() -> int:
    return int(time.time() * 1000)


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
