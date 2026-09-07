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
  updatedAt: number
}

const KEY = 'song-transcription:songs'
const PROGRESS_KEY = 'song-transcription:progress'

// crypto.randomUUID requires a secure context; over plain http://<lan-ip>
// (which mobile testing over the LAN uses) it throws. Fall back to a v4 UUID
// built from crypto.getRandomValues, which is available insecure too.
function makeId(): string {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function readAll(): Song[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Backfill fields added after initial release.
    return parsed.map((s) => ({ artist: '', spotifyUri: '', ...s })) as Song[]
  } catch {
    return []
  }
}

function writeAll(songs: Song[]) {
  localStorage.setItem(KEY, JSON.stringify(songs))
}

export function listSongs(): Song[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSong(id: string): Song | undefined {
  return readAll().find((s) => s.id === id)
}

export function saveSong(input: {
  id?: string
  title: string
  artist: string
  lyrics: string
  spotifyUri: string
}): Song {
  const songs = readAll()
  const now = Date.now()
  if (input.id) {
    const idx = songs.findIndex((s) => s.id === input.id)
    if (idx >= 0) {
      const existing = songs[idx]
      const updated: Song = {
        ...existing,
        title: input.title,
        artist: input.artist,
        lyrics: input.lyrics,
        spotifyUri: input.spotifyUri,
        updatedAt: now,
      }
      songs[idx] = updated
      writeAll(songs)
      // Word indices are position-based; a lyrics edit can shift them.
      if (existing.lyrics !== input.lyrics) clearProgress(input.id)
      return updated
    }
  }
  const created: Song = {
    id: makeId(),
    title: input.title,
    artist: input.artist,
    lyrics: input.lyrics,
    spotifyUri: input.spotifyUri,
    createdAt: now,
    updatedAt: now,
  }
  songs.push(created)
  writeAll(songs)
  return created
}

export function deleteSong(id: string) {
  writeAll(readAll().filter((s) => s.id !== id))
  clearProgress(id)
}

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
