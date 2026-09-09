"""Best-effort word translation via MyMemory (api.mymemory.translated.net).

MyMemory is free, no key required, ~5000 words/day per IP for anonymous
usage. Quality is good for single-word Spanish→English lookups. If quality
becomes an issue we can swap to DeepL (needs API key, 500k chars/month
free) without changing the interface.
"""

from __future__ import annotations

import httpx

MYMEMORY_URL = "https://api.mymemory.translated.net/get"
USER_AGENT = "SongTranscription/0.1 (personal Spanish practice app)"


async def to_english(word: str) -> tuple[str, str] | None:
    """Translate a single word to English. Returns (translation, source) or
    None on any failure — callers store `""` for both fields in that case."""
    q = word.strip()
    if not q:
        return None

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                MYMEMORY_URL,
                params={"q": q, "langpair": "es|en"},
                headers={"User-Agent": USER_AGENT},
            )
    except httpx.HTTPError:
        return None

    if res.status_code != 200:
        return None

    try:
        data = res.json()
    except ValueError:
        return None

    # MyMemory returns 200 even on quota exhaustion; check its status field.
    if data.get("responseStatus") != 200:
        return None

    translated = (data.get("responseData") or {}).get("translatedText") or ""
    translated = translated.strip()
    if not translated:
        return None
    # If the API echoes the query back, that means it found no real match.
    if translated.lower() == q.lower():
        return None
    return translated, "mymemory"
