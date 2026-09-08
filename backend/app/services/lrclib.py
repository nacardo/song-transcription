"""Thin async client for lrclib.net's public lyrics API.

We proxy from the backend rather than hitting lrclib from every browser so we
can (a) set a polite User-Agent identifying our app, (b) later cache results
if traffic grows, and (c) keep the frontend free of any awareness of the
lyrics provider.
"""

from __future__ import annotations

from typing import TypedDict

import httpx

LRCLIB_BASE = "https://lrclib.net"
# Per lrclib docs: identify yourself. Keep it short but distinctive so they
# can differentiate real users from generic scrapers.
USER_AGENT = "SongTranscription/0.1 (personal Spanish practice app)"


class LrcLibResult(TypedDict):
    syncedLyrics: str  # LRC-format string ("[mm:ss.xx]line...") or ""
    plainLyrics: str  # plain text lyrics (may be present even without sync)


async def search_track(
    *,
    track_name: str,
    artist_name: str,
    album_name: str = "",
    duration_sec: int | None = None,
) -> LrcLibResult | None:
    """Look up a track. Returns None on any not-found / error condition so
    callers can uniformly signal "no synced lyrics available"."""

    params: dict[str, str] = {
        "track_name": track_name,
        "artist_name": artist_name,
    }
    if album_name:
        params["album_name"] = album_name
    if duration_sec is not None:
        params["duration"] = str(duration_sec)

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(
                f"{LRCLIB_BASE}/api/get",
                params=params,
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

    synced = data.get("syncedLyrics") or ""
    plain = data.get("plainLyrics") or ""
    if not synced and not plain:
        return None
    return {"syncedLyrics": synced, "plainLyrics": plain}
