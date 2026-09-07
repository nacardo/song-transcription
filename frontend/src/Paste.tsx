import { useEffect, useMemo, useState } from 'react'
import { extractTitle } from './lyrics'
import { normalizeSpotifyUri } from './spotify'
import type { Song } from './storage'

type Props = {
  initial?: Song
  canCancel: boolean
  onSave: (fields: {
    title: string
    artist: string
    lyrics: string
    spotifyUri: string
  }) => void
  onCancel: () => void
}

export function Paste({ initial, canCancel, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [artist, setArtist] = useState(initial?.artist ?? '')
  const [lyrics, setLyrics] = useState(initial?.lyrics ?? '')
  const [spotifyInput, setSpotifyInput] = useState(initial?.spotifyUri ?? '')
  const [titleTouched, setTitleTouched] = useState(!!initial)

  useEffect(() => {
    if (titleTouched) return
    const suggested = extractTitle(lyrics)
    if (suggested) setTitle(suggested)
  }, [lyrics, titleTouched])

  const spotifyUri = useMemo(
    () => normalizeSpotifyUri(spotifyInput),
    [spotifyInput],
  )
  const spotifyInvalid = spotifyInput.trim().length > 0 && spotifyUri === null

  const canSave =
    title.trim().length > 0 && lyrics.trim().length > 0 && !spotifyInvalid

  return (
    <main>
      <h1>{initial ? 'Edit song' : 'New song'}</h1>

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
              setTitleTouched(true)
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
            onChange={(e) => setArtist(e.target.value)}
          />
        </div>
      </div>

      <label htmlFor="spotify">Spotify link</label>
      <input
        id="spotify"
        className={`title${spotifyInvalid ? ' invalid' : ''}`}
        type="text"
        value={spotifyInput}
        placeholder="https://open.spotify.com/track/… or spotify:track:… (optional)"
        onChange={(e) => setSpotifyInput(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {spotifyInvalid && (
        <div className="field-hint error">
          Not a Spotify track link. Use the "Share → Copy Song Link" URL.
        </div>
      )}

      <label htmlFor="lyrics">Lyrics</label>
      <textarea
        id="lyrics"
        rows={16}
        value={lyrics}
        onChange={(e) => setLyrics(e.target.value)}
        placeholder="Paste lyrics here..."
        autoFocus={!initial}
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
