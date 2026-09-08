import { useEffect, useRef, useState } from 'react'
import './App.css'
import { Library } from './Library'
import { Login } from './Login'
import { Paste } from './Paste'
import { Practice } from './Practice'
import { SettingsView } from './SettingsView'
import { checkSession, logout as apiLogout, onUnauthorized } from './api'
import {
  DEFAULTS as SETTINGS_DEFAULTS,
  getSettings,
  migrateLegacySettingsIfNeeded,
  saveSettings,
  type Settings,
} from './settings'
import { completeLogin, fetchAlbumArtUrl } from './spotify-auth'
import { trackIdFromUri } from './spotify'
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
  // authed: null = still checking session, true/false = known.
  const [authed, setAuthed] = useState<boolean | null>(null)
  // null = still loading from the backend. Everything downstream waits.
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [view, setView] = useState<View>({ name: 'library' })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const callbackHandled = useRef(false)

  async function handleSettingsChange(patch: Partial<Settings>) {
    // Optimistic: reflect the change immediately, then reconcile with server.
    setSettings((cur) => ({ ...(cur ?? SETTINGS_DEFAULTS), ...patch }))
    try {
      const next = await saveSettings(patch)
      setSettings(next)
    } catch (err) {
      console.warn('Failed to save settings', err)
    }
  }

  async function handleLogout() {
    try {
      await apiLogout()
    } catch (err) {
      console.warn('Logout call failed', err)
    }
    setAuthed(false)
  }

  // Handle the /callback landing after Spotify OAuth. Runs regardless of app
  // auth state — Spotify tokens are client-side and independent.
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

  // Initial session check.
  useEffect(() => {
    checkSession()
      .then(setAuthed)
      .catch(() => setAuthed(false))
  }, [])

  // Global 401 → back to login. Fired by api.ts on any protected fetch.
  useEffect(() => {
    return onUnauthorized(() => setAuthed(false))
  }, [])

  // Load app data whenever we transition into authed=true; clear on unauth.
  useEffect(() => {
    if (!authed) {
      setSongs(null)
      setSettings(null)
      setLoadError(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await migrateLegacySettingsIfNeeded()
        await migrateLegacySongsIfNeeded()
        await migrateLegacyProgressIfNeeded()
        const [initialSongs, initialSettings] = await Promise.all([
          listSongs(),
          getSettings(),
        ])
        if (cancelled) return
        setSongs(initialSongs)
        setSettings(initialSettings)
        // Always land on Library — even on first-run with no songs — so the
        // user can connect Spotify from its header before adding a song
        // (adding-a-song's autofill flow needs Spotify to be authed).
      } catch (err: unknown) {
        if (!cancelled) setLoadError(String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authed])

  async function handleSave(fields: {
    title: string
    artist: string
    lyrics: string
    spotifyUri: string
    syncedLyrics: string
    lyricsSource: string
  }) {
    const editingId = view.name === 'paste' ? view.editingId : undefined
    const existing = editingId
      ? songs?.find((s) => s.id === editingId)
      : undefined
    // Preserve the cached cover across an edit as long as the track didn't
    // change. If the user swapped the Spotify link (or cleared it), drop the
    // stale art — enrichment below will refill when appropriate.
    const preservedArt =
      existing && existing.spotifyUri === fields.spotifyUri
        ? existing.albumArtUrl
        : ''
    const saved = await saveSong({
      id: editingId,
      ...fields,
      albumArtUrl: preservedArt,
    })
    setSongs(await listSongs())
    setView({ name: 'practice', songId: saved.id })
    // Fire-and-forget: fetch album art if we have a track but no cached
    // cover yet. Requires Spotify auth; silently no-ops otherwise.
    if (saved.spotifyUri && !saved.albumArtUrl) {
      void enrichAlbumArt(saved).then((updated) => {
        if (!updated) return
        setSongs((prev) =>
          prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev,
        )
      })
    }
  }

  async function enrichAlbumArt(song: Song): Promise<Song | null> {
    const trackId = trackIdFromUri(song.spotifyUri)
    if (!trackId) return null
    const url = await fetchAlbumArtUrl(trackId)
    if (!url) return null
    try {
      // Include synced-lyrics fields so the PUT doesn't wipe them on the
      // second save — SongPayload defaults them to "" when omitted.
      return await saveSong({
        id: song.id,
        title: song.title,
        artist: song.artist,
        lyrics: song.lyrics,
        spotifyUri: song.spotifyUri,
        albumArtUrl: url,
        syncedLyrics: song.syncedLyrics,
        lyricsSource: song.lyricsSource,
      })
    } catch (err) {
      console.warn('Failed to persist album art', err)
      return null
    }
  }

  async function handleDelete(id: string) {
    await deleteSong(id)
    const remaining = await listSongs()
    setSongs(remaining)
  }

  if (authed === null) {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />
  }

  if (loadError) {
    return (
      <main>
        <h1>Song Transcription</h1>
        <p className="error">Couldn't load: {loadError}</p>
        <p className="muted">Is the backend running?</p>
      </main>
    )
  }

  if (songs === null || settings === null) {
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
        onLogout={handleLogout}
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
        canCancel
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
