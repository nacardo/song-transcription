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

const SONGS_API = '/api/songs'

async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  })
  return res
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init)
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

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

// ---------- Progress (still localStorage; moves in Phase C) ----------

const PROGRESS_KEY = 'song-transcription:progress'

function readProgress(): Record<string, Progress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeProgress(all: Record<string, Progress>) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all))
}

export function getProgress(songId: string): Progress | undefined {
  return readProgress()[songId]
}

export function saveProgress(
  songId: string,
  progress: Omit<Progress, 'updatedAt'>,
) {
  const all = readProgress()
  all[songId] = { ...progress, updatedAt: Date.now() }
  writeProgress(all)
}

export function clearProgress(songId: string) {
  const all = readProgress()
  if (!(songId in all)) return
  delete all[songId]
  writeProgress(all)
}
