import { useEffect, useState } from 'react'
import {
  deleteLookup,
  listLookups,
  type WordLookup,
} from './dictionary'

type Props = {
  onBack: () => void
  onOpenSong: (id: string) => void
}

// Spanish → English WordReference URL — same helper Practice uses, kept
// local here so the dictionary view is self-contained.
function wordReferenceUrl(word: string): string {
  return `https://www.wordreference.com/es/en/translation.asp?spen=${encodeURIComponent(word)}`
}

export function DictionaryView({ onBack, onOpenSong }: Props) {
  const [entries, setEntries] = useState<WordLookup[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listLookups()
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleDelete(id: string) {
    if (!confirm('Remove this word from your dictionary?')) return
    // Optimistic: drop immediately, roll back if the server rejects.
    const snapshot = entries
    setEntries((cur) => cur?.filter((e) => e.id !== id) ?? null)
    try {
      await deleteLookup(id)
    } catch (err) {
      console.warn('Failed to delete lookup', err)
      setEntries(snapshot)
    }
  }

  return (
    <main>
      <header className="song-header">
        <button type="button" className="link" onClick={onBack}>
          ← Library
        </button>
        <div className="song-header-title">
          <div className="song-header-text">
            <h1>Dictionary</h1>
          </div>
        </div>
        <span aria-hidden="true" />
      </header>

      {loadError && (
        <div className="banner error" role="alert">
          <span>Couldn't load dictionary: {loadError}</span>
        </div>
      )}

      {entries === null && !loadError && (
        <p className="muted">Loading…</p>
      )}

      {entries && entries.length === 0 && (
        <p className="muted library-empty">
          No words yet. Look up a word with the <em>📖</em> button in a song
          and it will show up here.
        </p>
      )}

      {entries && entries.length > 0 && (
        <ul className="dictionary-list">
          {entries.map((e) => (
            <li key={e.id} className="dictionary-row">
              <div className="dictionary-word">
                <a
                  href={wordReferenceUrl(e.display || e.word)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dictionary-word-link"
                  title="Look up on WordReference"
                >
                  {e.display || e.word}
                </a>
                {e.translation && (
                  <span className="dictionary-translation">
                    {' — '}
                    {e.translation}
                  </span>
                )}
              </div>
              <div className="dictionary-meta">
                {e.songId ? (
                  <button
                    type="button"
                    className="link small"
                    onClick={() => onOpenSong(e.songId!)}
                    title="Open source song"
                  >
                    {e.songTitle || '(untitled)'}
                  </button>
                ) : e.songTitle ? (
                  <span className="muted">{e.songTitle}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="row-action danger"
                onClick={() => handleDelete(e.id)}
                aria-label="Delete entry"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
