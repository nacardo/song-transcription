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
    id: crypto.randomUUID(),
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
