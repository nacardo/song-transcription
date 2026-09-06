import type { Song } from './storage'

type Props = {
  songs: Song[]
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
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

export function Library({ songs, onOpen, onEdit, onDelete, onNew }: Props) {
  return (
    <main>
      <header className="library-header">
        <h1>Your songs</h1>
        <button type="button" className="primary" onClick={onNew}>
          + New song
        </button>
      </header>

      <ul className="song-list">
        {songs.map((song) => (
          <li key={song.id} className="song-row">
            <button
              type="button"
              className="song-open"
              onClick={() => onOpen(song.id)}
            >
              <span className="song-open-main">
                <span className="song-title">{song.title}</span>
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
