export type Song = {
  id: string
  title: string
  artist: string
  lyrics: string
  createdAt: number
  updatedAt: number
}

const KEY = 'song-transcription:songs'

function readAll(): Song[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Backfill fields added after initial release.
    return parsed.map((s) => ({ artist: '', ...s })) as Song[]
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
}): Song {
  const songs = readAll()
  const now = Date.now()
  if (input.id) {
    const idx = songs.findIndex((s) => s.id === input.id)
    if (idx >= 0) {
      const updated: Song = {
        ...songs[idx],
        title: input.title,
        artist: input.artist,
        lyrics: input.lyrics,
        updatedAt: now,
      }
      songs[idx] = updated
      writeAll(songs)
      return updated
    }
  }
  const created: Song = {
    id: crypto.randomUUID(),
    title: input.title,
    artist: input.artist,
    lyrics: input.lyrics,
    createdAt: now,
    updatedAt: now,
  }
  songs.push(created)
  writeAll(songs)
  return created
}

export function deleteSong(id: string) {
  writeAll(readAll().filter((s) => s.id !== id))
}
