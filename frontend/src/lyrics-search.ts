// Frontend client for /api/lyrics/search — a thin proxy over lrclib.net.
// Kept separate from storage.ts because it isn't backed by our DB; it's a
// one-shot lookup used at song-creation time.

import { apiFetch } from './api'

export type LyricsSearchResult = {
  syncedLyrics: string
  plainLyrics: string
  source: string // "lrclib"
}

export type LyricsSearchQuery = {
  trackName: string
  artistName: string
  albumName?: string
  durationSec?: number
}

// Returns null when nothing was found (404) or on any transport error. The
// caller shows a "paste your own" message either way.
export async function searchLyrics(
  q: LyricsSearchQuery,
): Promise<LyricsSearchResult | null> {
  const params = new URLSearchParams({
    trackName: q.trackName,
    artistName: q.artistName,
  })
  if (q.albumName) params.set('albumName', q.albumName)
  if (q.durationSec !== undefined) {
    params.set('durationSec', String(q.durationSec))
  }
  try {
    const res = await apiFetch(`/api/lyrics/search?${params.toString()}`)
    if (res.status === 404) return null
    if (!res.ok) return null
    return (await res.json()) as LyricsSearchResult
  } catch {
    return null
  }
}
