import { useEffect, useRef, useState } from 'react'
import './App.css'
import { Library } from './Library'
import { Paste } from './Paste'
import { Practice } from './Practice'
import { SettingsView } from './SettingsView'
import {
  getSettings,
  saveSettings,
  type Settings,
} from './settings'
import { completeLogin } from './spotify-auth'
import {
  deleteSong,
  listSongs,
  migrateLegacyProgressIfNeeded,
  migrateLegacySongsIfNeeded,
  saveSong,
  type Song,
} from './storage'

type View =
  | { name: 'library' }
  | { name: 'paste'; editingId?: string }
  | { name: 'practice'; songId: string }
  | { name: 'settings' }

export default function App() {
  // null = still loading from the backend. Everything downstream waits.
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [view, setView] = useState<View>({ name: 'library' })
  const [settings, setSettings] = useState<Settings>(() => getSettings())
  const [authError, setAuthError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const callbackHandled = useRef(false)

  function handleSettingsChange(patch: Partial<Settings>) {
    setSettings(saveSettings(patch))
  }

  // Handle the /callback landing after Spotify OAuth.
  // Guarded against React StrictMode's double-effect in dev — an OAuth code
  // is single-use, so exchanging it twice fails the second attempt.
  useEffect(() => {
    if (window.location.pathname !== '/callback') return
    if (callbackHandled.current) return
    callbackHandled.current = true
    completeLogin()
      .catch((err: unknown) => setAuthError(String(err)))
      .finally(() => {
        window.history.replaceState({}, '', '/')
      })
  }, [])

  // Initial load: migrate any legacy localStorage songs (once), then fetch.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await migrateLegacySongsIfNeeded()
        await migrateLegacyProgressIfNeeded()
        const initial = await listSongs()
        if (cancelled) return
        setSongs(initial)
        // First-run: no songs → jump straight to paste, like before.
        if (initial.length === 0) setView({ name: 'paste' })
      } catch (err: unknown) {
        if (!cancelled) setLoadError(String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave(fields: {
    title: string
    artist: string
    lyrics: string
    spotifyUri: string
  }) {
    const editingId = view.name === 'paste' ? view.editingId : undefined
    const saved = await saveSong({ id: editingId, ...fields })
    setSongs(await listSongs())
    setView({ name: 'practice', songId: saved.id })
  }

  async function handleDelete(id: string) {
    await deleteSong(id)
    const remaining = await listSongs()
    setSongs(remaining)
    if (remaining.length === 0) setView({ name: 'paste' })
  }

  if (loadError) {
    return (
      <main>
        <h1>Song Transcription</h1>
        <p className="error">Couldn't load songs: {loadError}</p>
        <p className="muted">Is the backend running?</p>
      </main>
    )
  }

  if (songs === null) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (view.name === 'library') {
    return (
      <Library
        songs={songs}
        authError={authError}
        onDismissAuthError={() => setAuthError(null)}
        onOpen={(id) => setView({ name: 'practice', songId: id })}
        onEdit={(id) => setView({ name: 'paste', editingId: id })}
        onDelete={handleDelete}
        onNew={() => setView({ name: 'paste' })}
        onOpenSettings={() => setView({ name: 'settings' })}
      />
    )
  }

  if (view.name === 'settings') {
    return (
      <SettingsView
        settings={settings}
        onChange={handleSettingsChange}
        onBack={() => setView({ name: 'library' })}
      />
    )
  }

  if (view.name === 'paste') {
    const initial = view.editingId
      ? songs.find((s) => s.id === view.editingId)
      : undefined
    return (
      <Paste
        initial={initial}
        canCancel={songs.length > 0}
        onSave={handleSave}
        onCancel={() => setView({ name: 'library' })}
      />
    )
  }

  const song = songs.find((s) => s.id === view.songId)
  if (!song) {
    setView({ name: 'library' })
    return null
  }
  return (
    <Practice
      song={song}
      settings={settings}
      onBack={() => setView({ name: 'library' })}
      onEdit={() => setView({ name: 'paste', editingId: song.id })}
    />
  )
}
