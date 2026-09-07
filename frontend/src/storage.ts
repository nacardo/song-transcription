export type Song = {
  id: string
  title: string
  artist: string
  lyrics: string
  spotifyUri: string
  createdAt: number
  updatedAt: number
}

export type Progress = {
  answers: Record<number, string>
  revealed: number[]
  positionMs?: number
  updatedAt: number
}

// ---------- Songs (backend-backed) ----------

import { apiFetch, apiJson } from './api'

const SONGS_API = '/api/songs'

export async function listSongs(): Promise<Song[]> {
  return apiJson<Song[]>(SONGS_API)
}

export async function getSong(id: string): Promise<Song | undefined> {
  const res = await apiFetch(`${SONGS_API}/${id}`)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`GET ${SONGS_API}/${id} failed: ${res.status}`)
  return (await res.json()) as Song
}

export async function saveSong(input: {
  id?: string
  title: string
  artist: string
  lyrics: string
  spotifyUri: string
}): Promise<Song> {
  const body = JSON.stringify({
    title: input.title,
    artist: input.artist,
    lyrics: input.lyrics,
    spotifyUri: input.spotifyUri,
  })
  if (input.id) {
    return apiJson<Song>(`${SONGS_API}/${input.id}`, {
      method: 'PUT',
      body,
    })
  }
  return apiJson<Song>(SONGS_API, { method: 'POST', body })
}

export async function deleteSong(id: string): Promise<void> {
  await apiFetch(`${SONGS_API}/${id}`, { method: 'DELETE' })
}

// One-shot migration of any localStorage songs into the backend, gated by a
// flag so it never re-runs. Progress stays in localStorage for now — Phase C
// will migrate that separately.
const LEGACY_SONGS_KEY = 'song-transcription:songs'
const MIGRATION_FLAG = 'song-transcription:migrated:songs-v1'

export async function migrateLegacySongsIfNeeded(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return
  const raw = localStorage.getItem(LEGACY_SONGS_KEY)
  if (!raw) {
    localStorage.setItem(MIGRATION_FLAG, '1')
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    localStorage.setItem(MIGRATION_FLAG, '1')
    return
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    localStorage.setItem(MIGRATION_FLAG, '1')
    return
  }
  // Only migrate into an empty backend so we don't ever duplicate.
  const existing = await listSongs()
  if (existing.length > 0) {
    localStorage.setItem(MIGRATION_FLAG, '1')
    return
  }
  for (const s of parsed as Array<Partial<Song>>) {
    if (!s.id || typeof s.title !== 'string' || typeof s.lyrics !== 'string') {
      continue
    }
    await apiFetch(`${SONGS_API}/${s.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: s.title,
        artist: s.artist ?? '',
        lyrics: s.lyrics,
        spotifyUri: s.spotifyUri ?? '',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }),
    })
  }
  localStorage.setItem(MIGRATION_FLAG, '1')
}

// ---------- Progress (backend-backed) ----------

const PROGRESS_API = '/api/progress'

export async function getProgress(
  songId: string,
): Promise<Progress | undefined> {
  const res = await apiFetch(`${PROGRESS_API}/${songId}`)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`GET ${PROGRESS_API}/${songId} failed: ${res.status}`)
  return (await res.json()) as Progress
}

export async function saveProgress(
  songId: string,
  progress: Omit<Progress, 'updatedAt'>,
): Promise<void> {
  await apiFetch(`${PROGRESS_API}/${songId}`, {
    method: 'PUT',
    body: JSON.stringify(progress),
  })
}

export async function clearProgress(songId: string): Promise<void> {
  await apiFetch(`${PROGRESS_API}/${songId}`, { method: 'DELETE' })
}

const LEGACY_PROGRESS_KEY = 'song-transcription:progress'
const PROGRESS_MIGRATION_FLAG = 'song-transcription:migrated:progress-v1'

// One-shot migration for progress. Runs after songs migrate, so any song IDs
// referenced here already exist on the backend. Orphan entries (progress for
// a song that never made it over) are quietly skipped.
export async function migrateLegacyProgressIfNeeded(): Promise<void> {
  if (localStorage.getItem(PROGRESS_MIGRATION_FLAG)) return
  const raw = localStorage.getItem(LEGACY_PROGRESS_KEY)
  if (!raw) {
    localStorage.setItem(PROGRESS_MIGRATION_FLAG, '1')
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    localStorage.setItem(PROGRESS_MIGRATION_FLAG, '1')
    return
  }
  if (!parsed || typeof parsed !== 'object') {
    localStorage.setItem(PROGRESS_MIGRATION_FLAG, '1')
    return
  }
  for (const [songId, prog] of Object.entries(
    parsed as Record<string, Progress>,
  )) {
    if (!prog || typeof prog !== 'object') continue
    // Backend rejects orphan progress; silently skip those.
    const res = await apiFetch(`${PROGRESS_API}/${songId}`, {
      method: 'PUT',
      body: JSON.stringify({
        answers: prog.answers ?? {},
        revealed: prog.revealed ?? [],
        positionMs: prog.positionMs,
      }),
    })
    if (!res.ok && res.status !== 404) {
      // Non-404 is an unexpected failure; log and keep going.
      console.warn(`Progress migration for ${songId} failed: ${res.status}`)
    }
  }
  localStorage.setItem(PROGRESS_MIGRATION_FLAG, '1')
}
