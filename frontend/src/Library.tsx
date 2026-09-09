import { SpotifyStatus } from './SpotifyStatus'
import type { Song } from './storage'

type Props = {
  songs: Song[]
  authError: string | null
  onDismissAuthError: () => void
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
  onOpenSettings: () => void
  onOpenDictionary: () => void
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const s = Math.round(diff / 1000)
  if (s < 60) return rtf.format(-s, 'second')
  const m = Math.round(diff / 60000)
  if (m < 60) return rtf.format(-m, 'minute')
  const h = Math.round(diff / 3600000)
  if (h < 24) return rtf.format(-h, 'hour')
  const d = Math.round(diff / 86400000)
  if (d < 30) return rtf.format(-d, 'day')
  return new Date(ts).toLocaleDateString()
}

export function Library({
  songs,
  authError,
  onDismissAuthError,
  onOpen,
  onEdit,
  onDelete,
  onNew,
  onOpenSettings,
  onOpenDictionary,
}: Props) {
  return (
    <main>
      <header className="library-header">
        <h1>Your songs</h1>
        <div className="library-header-actions">
          <SpotifyStatus />
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenDictionary}
            aria-label="Dictionary"
            title="Dictionary"
          >
            📖
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
          <button type="button" className="primary" onClick={onNew}>
            + New song
          </button>
        </div>
      </header>

      {authError && (
        <div className="banner error" role="alert">
          <span>Spotify sign-in failed: {authError}</span>
          <button type="button" className="link" onClick={onDismissAuthError}>
            Dismiss
          </button>
        </div>
      )}

      {songs.length === 0 && (
        <p className="muted library-empty">
          No songs yet. Connect Spotify above, then hit <em>+ New song</em> to
          add your first one.
        </p>
      )}

      <ul className="song-list">
        {songs.map((song) => (
          <li key={song.id} className="song-row">
            <button
              type="button"
              className="song-open"
              onClick={() => onOpen(song.id)}
            >
              {song.albumArtUrl ? (
                <img
                  className="song-cover"
                  src={song.albumArtUrl}
                  alt=""
                  loading="lazy"
                  aria-hidden="true"
                />
              ) : (
                <span className="song-cover placeholder" aria-hidden="true" />
              )}
              <span className="song-open-main">
                <span className="song-title">
                  {song.title}
                  {song.spotifyUri && !song.albumArtUrl && (
                    <span
                      className="spotify-dot"
                      title="Has Spotify track"
                      aria-label="Has Spotify track"
                    />
                  )}
                </span>
                {song.artist && (
                  <span className="song-artist">{song.artist}</span>
                )}
              </span>
              <span className="song-meta">{relativeTime(song.updatedAt)}</span>
            </button>
            <button
              type="button"
              className="row-action"
              onClick={() => onEdit(song.id)}
            >
              Edit
            </button>
            <button
              type="button"
              className="row-action danger"
              onClick={() => {
                if (confirm(`Delete "${song.title}"?`)) onDelete(song.id)
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
