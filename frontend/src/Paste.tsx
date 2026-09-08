import { useEffect, useMemo, useRef, useState } from 'react'
import { extractTitle } from './lyrics'
import { searchLyrics } from './lyrics-search'
import { normalizeSpotifyUri, trackIdFromUri } from './spotify'
import { fetchTrackMeta, isAuthenticated as spotifyReady } from './spotify-auth'
import type { Song } from './storage'

type Props = {
  initial?: Song
  canCancel: boolean
  onSave: (fields: {
    title: string
    artist: string
    lyrics: string
    spotifyUri: string
    syncedLyrics: string
    lyricsSource: string
  }) => void
  onCancel: () => void
}

type LyricsLookup =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'found'; source: string; plain: string; synced: string }
  | { state: 'not-found' }
  | { state: 'no-auth' }
  | { state: 'error'; message: string }

// LRC → plain text: drop the [mm:ss.xx] prefixes so a user can practice
// against readable lines. Preserves original line order and blank lines.
function lrcToPlain(lrc: string): string {
  return lrc
    .split(/\r?\n/)
    .map((line) => line.replace(/^(?:\[[^\]]*\])+/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function Paste({ initial, canCancel, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [artist, setArtist] = useState(initial?.artist ?? '')
  const [lyrics, setLyrics] = useState(initial?.lyrics ?? '')
  const [spotifyInput, setSpotifyInput] = useState(initial?.spotifyUri ?? '')
  // Synced-lyrics state: separate from the visible lyrics textarea because
  // the user sees plain text; we ship the LRC-format string on save.
  const [syncedLyrics, setSyncedLyrics] = useState(initial?.syncedLyrics ?? '')
  const [lyricsSource, setLyricsSource] = useState(initial?.lyricsSource ?? '')
  const [lookup, setLookup] = useState<LyricsLookup>({ state: 'idle' })
  // Track whether the user has manually edited a field so auto-fill from
  // Spotify/LRCLIB doesn't clobber their edits. Refs (not state) so the
  // fetch effect doesn't re-fire on every keystroke.
  const titleTouched = useRef(!!initial?.title)
  const artistTouched = useRef(!!initial?.artist)
  const userEditedLyrics = useRef(!!initial?.lyrics)

  // Fallback when there's no Spotify link: try to pull a title out of the
  // pasted lyrics. Kept from the pre-Spotify workflow — only runs while the
  // title is still untouched.
  useEffect(() => {
    if (titleTouched.current) return
    const suggested = extractTitle(lyrics)
    if (suggested) setTitle(suggested)
  }, [lyrics])

  const spotifyUri = useMemo(
    () => normalizeSpotifyUri(spotifyInput),
    [spotifyInput],
  )
  const spotifyInvalid = spotifyInput.trim().length > 0 && spotifyUri === null

  // Spotify-driven autofill: pastes name/artist from the track, then hits
  // lrclib for synced lyrics. Runs whenever the URI changes to a new valid
  // value; skipped for edits that don't change the track.
  useEffect(() => {
    if (!spotifyUri) {
      setLookup({ state: 'idle' })
      return
    }
    if (initial && initial.spotifyUri === spotifyUri && initial.syncedLyrics) {
      // Already have lyrics for this exact track; no need to re-fetch.
      setLookup({
        state: 'found',
        source: initial.lyricsSource || 'lrclib',
        plain: lrcToPlain(initial.syncedLyrics),
        synced: initial.syncedLyrics,
      })
      return
    }
    if (!spotifyReady()) {
      setLookup({ state: 'no-auth' })
      return
    }
    const trackId = trackIdFromUri(spotifyUri)
    if (!trackId) return
    let cancelled = false
    setLookup({ state: 'searching' })
    ;(async () => {
      try {
        const meta = await fetchTrackMeta(trackId)
        if (cancelled) return
        if (!meta) {
          setLookup({ state: 'error', message: 'Spotify lookup failed' })
          return
        }
        // Autofill title/artist from the Spotify track — only if the user
        // hasn't already typed something into those fields.
        if (!titleTouched.current && meta.name) setTitle(meta.name)
        if (!artistTouched.current && meta.artistName) {
          setArtist(meta.artistName)
        }
        const result = await searchLyrics({
          trackName: meta.name,
          artistName: meta.artistName,
          albumName: meta.albumName,
          durationSec: Math.round(meta.durationMs / 1000) || undefined,
        })
        if (cancelled) return
        if (!result || !result.syncedLyrics) {
          setLookup({ state: 'not-found' })
          setSyncedLyrics('')
          setLyricsSource('')
          return
        }
        setLookup({
          state: 'found',
          source: result.source,
          plain: lrcToPlain(result.syncedLyrics),
          synced: result.syncedLyrics,
        })
        // Only persist the LRC when we're also applying its plain form to
        // the visible lyrics — otherwise the two would diverge and the
        // Practice renderer (which prefers syncedLyrics) would show text the
        // user never saw here. When the user already has lyrics, they get
        // the "Replace with fetched lyrics" button to opt in.
        if (!userEditedLyrics.current && !lyrics.trim()) {
          setLyrics(lrcToPlain(result.syncedLyrics))
          setSyncedLyrics(result.syncedLyrics)
          setLyricsSource(result.source)
        } else {
          setSyncedLyrics('')
          setLyricsSource('')
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setLookup({ state: 'error', message: String(err) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Intentionally only re-run on spotifyUri changes; other reads inside
    // the effect are refs or current values we don't want to re-trigger on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotifyUri])

  const canSave =
    title.trim().length > 0 && lyrics.trim().length > 0 && !spotifyInvalid

  function replaceLyricsWithLookup() {
    if (lookup.state !== 'found') return
    setLyrics(lookup.plain)
    setSyncedLyrics(lookup.synced)
    setLyricsSource(lookup.source)
    userEditedLyrics.current = false
  }

  return (
    <main>
      <h1>{initial ? 'Edit song' : 'New song'}</h1>

      <label htmlFor="spotify">Spotify Link (add this and we'll try to fetch the rest)</label>
      <input
        id="spotify"
        className={`title${spotifyInvalid ? ' invalid' : ''}`}
        type="text"
        value={spotifyInput}
        placeholder="https://open.spotify.com/track/… or spotify:track:…"
        onChange={(e) => setSpotifyInput(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={!initial}
      />
      {spotifyInvalid && (
        <div className="field-hint error">
          Not a Spotify track link. Use the "Share → Copy Song Link" URL.
        </div>
      )}
      {!spotifyInvalid && (
        <LookupStatus
          lookup={lookup}
          hasLyrics={lyrics.trim().length > 0}
          onUseLookup={replaceLyricsWithLookup}
        />
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            className="title"
            type="text"
            value={title}
            placeholder="Song title"
            onChange={(e) => {
              setTitle(e.target.value)
              titleTouched.current = true
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="artist">Artist</label>
          <input
            id="artist"
            className="title"
            type="text"
            value={artist}
            placeholder="Artist (optional)"
            onChange={(e) => {
              setArtist(e.target.value)
              artistTouched.current = true
            }}
          />
        </div>
      </div>

      <label htmlFor="lyrics">Lyrics</label>
      <textarea
        id="lyrics"
        rows={16}
        value={lyrics}
        onChange={(e) => {
          setLyrics(e.target.value)
          userEditedLyrics.current = true
          // Any manual edit invalidates the previously-fetched synced text.
          // A user who then wants sync back can re-paste the Spotify link.
          if (syncedLyrics) {
            setSyncedLyrics('')
            setLyricsSource('')
          }
        }}
        placeholder="Paste lyrics here (or add a Spotify link above to auto-fetch)…"
      />

      <div className="actions">
        <button
          type="button"
          onClick={() =>
            onSave({
              title: title.trim(),
              artist: artist.trim(),
              lyrics: lyrics.trim(),
              spotifyUri: spotifyUri ?? '',
              syncedLyrics,
              lyricsSource,
            })
          }
          disabled={!canSave}
        >
          {initial ? 'Save' : 'Save & start'}
        </button>
        {canCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </main>
  )
}

function LookupStatus({
  lookup,
  hasLyrics,
  onUseLookup,
}: {
  lookup: LyricsLookup
  hasLyrics: boolean
  onUseLookup: () => void
}) {
  if (lookup.state === 'idle') return null
  if (lookup.state === 'searching') {
    return (
      <div className="field-hint">
        Looking up track on Spotify and searching lrclib.net for synced lyrics…
      </div>
    )
  }
  if (lookup.state === 'no-auth') {
    return (
      <div className="field-hint">
        Connect Spotify (top-right on the library) to auto-fill title, artist,
        and synced lyrics.
      </div>
    )
  }
  if (lookup.state === 'not-found') {
    return (
      <div className="field-hint">
        No synced lyrics found — paste the lyrics below.
      </div>
    )
  }
  if (lookup.state === 'error') {
    return (
      <div className="field-hint error">
        Lyrics lookup failed: {lookup.message}
      </div>
    )
  }
  // found
  return (
    <div className="field-hint">
      ✓ Synced lyrics found via {lookup.source}.
      {hasLyrics && (
        <>
          {' '}
          <button
            type="button"
            className="link small"
            onClick={onUseLookup}
          >
            Replace with fetched lyrics
          </button>
        </>
      )}
    </div>
  )
}
