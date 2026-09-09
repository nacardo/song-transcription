import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..db import get_session
from ..deps import require_auth
from ..models import Song, WordLookup, WordLookupCreate, WordLookupRead
from ..services import translate

router = APIRouter(
    prefix="/api/dictionary",
    tags=["dictionary"],
    dependencies=[Depends(require_auth)],
)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize(word: str) -> str:
    # Lowercase + trim; accents preserved so `canción` ≠ `cancion` — the app
    # explicitly trains the user on accents.
    return word.strip().lower()


@router.get("", response_model=list[WordLookupRead], response_model_by_alias=True)
def list_lookups(session: Session = Depends(get_session)) -> list[WordLookup]:
    stmt = select(WordLookup).order_by(WordLookup.looked_up_at.desc())
    return list(session.exec(stmt).all())


@router.post(
    "",
    response_model=WordLookupRead,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_or_refresh(
    payload: WordLookupCreate,
    session: Session = Depends(get_session),
) -> WordLookup:
    """Idempotent by (word, song_id) — a repeat lookup of the same word from
    the same song bumps `looked_up_at` instead of creating a duplicate row.
    The same word in a different song is a distinct entry, because context
    matters when reviewing vocab later."""

    word = _normalize(payload.word)
    if not word:
        raise HTTPException(status_code=422, detail="Word is required")
    display = payload.display or payload.word

    # Look for an existing row with the same (word, song_id) — SQLite treats
    # NULL as distinct in unique indexes, so we upsert manually rather than
    # relying on ON CONFLICT.
    stmt = select(WordLookup).where(
        WordLookup.word == word,
        WordLookup.song_id == payload.song_id,
    )
    existing = session.exec(stmt).first()
    if existing is not None:
        existing.looked_up_at = _now_ms()
        # Keep display up to date in case casing changed.
        existing.display = display
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    # Snapshot the song title so this row is meaningful even if the song is
    # later deleted (`song_id` becomes NULL, title stays).
    song_title = ""
    if payload.song_id:
        song = session.get(Song, payload.song_id)
        if song is not None:
            song_title = song.title

    # Best-effort translation — silence any failure and just store the word.
    translation, source = "", ""
    result = await translate.to_english(word)
    if result is not None:
        translation, source = result

    entry = WordLookup(
        id=str(uuid.uuid4()),
        word=word,
        display=display,
        translation=translation,
        translation_source=source,
        song_id=payload.song_id,
        song_title=song_title,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/{lookup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lookup(
    lookup_id: str,
    session: Session = Depends(get_session),
) -> None:
    entry = session.get(WordLookup, lookup_id)
    if entry is not None:
        session.delete(entry)
        session.commit()
