import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..db import get_session
from ..models import Song, SongPayload, SongRead

router = APIRouter(prefix="/api/songs", tags=["songs"])


def _now_ms() -> int:
    return int(time.time() * 1000)


@router.get("", response_model=list[SongRead], response_model_by_alias=True)
def list_songs(session: Session = Depends(get_session)) -> list[Song]:
    stmt = select(Song).order_by(Song.updated_at.desc())
    return list(session.exec(stmt).all())


@router.get(
    "/{song_id}",
    response_model=SongRead,
    response_model_by_alias=True,
)
def get_song(song_id: str, session: Session = Depends(get_session)) -> Song:
    song = session.get(Song, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@router.post(
    "",
    response_model=SongRead,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
def create_song(
    payload: SongPayload,
    session: Session = Depends(get_session),
) -> Song:
    now = _now_ms()
    fields = payload.model_dump(exclude={"created_at", "updated_at"})
    song = Song(
        id=str(uuid.uuid4()),
        created_at=payload.created_at or now,
        updated_at=payload.updated_at or now,
        **fields,
    )
    session.add(song)
    session.commit()
    session.refresh(song)
    return song


@router.put(
    "/{song_id}",
    response_model=SongRead,
    response_model_by_alias=True,
)
def upsert_song(
    song_id: str,
    payload: SongPayload,
    session: Session = Depends(get_session),
) -> Song:
    now = _now_ms()
    fields = payload.model_dump(exclude={"created_at", "updated_at"})
    song = session.get(Song, song_id)
    if song is None:
        song = Song(
            id=song_id,
            created_at=payload.created_at or now,
            updated_at=payload.updated_at or now,
            **fields,
        )
    else:
        for k, v in fields.items():
            setattr(song, k, v)
        song.updated_at = payload.updated_at or now
    session.add(song)
    session.commit()
    session.refresh(song)
    return song


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(song_id: str, session: Session = Depends(get_session)) -> None:
    song = session.get(Song, song_id)
    if song is not None:
        session.delete(song)
        session.commit()
