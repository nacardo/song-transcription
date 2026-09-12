import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..db import get_session
from ..deps import require_auth
from ..models import PhraseLookup, PhraseLookupCreate, PhraseLookupRead, Song
from ..services import translate

router = APIRouter(
    prefix="/api/phrases",
    tags=["phrases"],
    dependencies=[Depends(require_auth)],
)


def _now_ms() -> int:
    return int(time.time() * 1000)


@router.get(
    "",
    response_model=list[PhraseLookupRead],
    response_model_by_alias=True,
)
def list_phrases(session: Session = Depends(get_session)) -> list[PhraseLookup]:
    stmt = select(PhraseLookup).order_by(PhraseLookup.saved_at.desc())
    return list(session.exec(stmt).all())


@router.post(
    "",
    response_model=PhraseLookupRead,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_or_refresh(
    payload: PhraseLookupCreate,
    session: Session = Depends(get_session),
) -> PhraseLookup:
    """Idempotent by (song_id, start_index, end_index) — saving the same
    stretch twice just bumps saved_at instead of duplicating a row."""

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text is required")
    # Normalize the range so callers don't have to.
    lo = min(payload.start_index, payload.end_index)
    hi = max(payload.start_index, payload.end_index)
    if lo < 0:
        raise HTTPException(status_code=422, detail="Indices must be non-negative")

    stmt = select(PhraseLookup).where(
        PhraseLookup.song_id == payload.song_id,
        PhraseLookup.start_index == lo,
        PhraseLookup.end_index == hi,
    )
    existing = session.exec(stmt).first()
    if existing is not None:
        existing.saved_at = _now_ms()
        existing.text = text
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    # Snapshot the song title so this row still makes sense after the song
    # is deleted (FK goes SET NULL, title stays).
    song_title = ""
    if payload.song_id:
        song = session.get(Song, payload.song_id)
        if song is not None:
            song_title = song.title

    # Best-effort translation of the whole phrase.
    translation, source = "", ""
    result = await translate.to_english(text)
    if result is not None:
        translation, source = result

    entry = PhraseLookup(
        id=str(uuid.uuid4()),
        text=text,
        translation=translation,
        translation_source=source,
        song_id=payload.song_id,
        song_title=song_title,
        start_index=lo,
        end_index=hi,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/{phrase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_phrase(
    phrase_id: str,
    session: Session = Depends(get_session),
) -> None:
    entry = session.get(PhraseLookup, phrase_id)
    if entry is not None:
        session.delete(entry)
        session.commit()
