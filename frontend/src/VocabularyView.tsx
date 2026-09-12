import { useEffect, useState } from 'react'
import {
  deleteLookup,
  listLookups,
  type WordLookup,
} from './dictionary'
import {
  deletePhrase,
  listPhrases,
  type Phrase,
} from './phrases'

type Props = {
  onBack: () => void
  // Second arg optional: when set, Practice seeks playback to that word's
  // synced-lyrics timestamp on mount (used from the Phrases tab).
  onOpenSong: (id: string, jumpToWordIndex?: number) => void
}

type Tab = 'words' | 'phrases'

function wordReferenceUrl(word: string): string {
  return `https://www.wordreference.com/es/en/translation.asp?spen=${encodeURIComponent(word)}`
}

export function VocabularyView({ onBack, onOpenSong }: Props) {
  const [tab, setTab] = useState<Tab>('words')
  const [words, setWords] = useState<WordLookup[] | null>(null)
  const [phrases, setPhrases] = useState<Phrase[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listLookups(), listPhrases()])
      .then(([w, p]) => {
        if (cancelled) return
        setWords(w)
        setPhrases(p)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <header className="song-header">
        <button type="button" className="link" onClick={onBack}>
          ← Library
        </button>
        <div className="song-header-title">
          <div className="song-header-text">
            <h1>Vocabulary</h1>
          </div>
        </div>
        <span aria-hidden="true" />
      </header>

      <div className="tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'words'}
          className={`tab-button${tab === 'words' ? ' active' : ''}`}
          onClick={() => setTab('words')}
        >
          Words{words ? ` (${words.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'phrases'}
          className={`tab-button${tab === 'phrases' ? ' active' : ''}`}
          onClick={() => setTab('phrases')}
        >
          Phrases{phrases ? ` (${phrases.length})` : ''}
        </button>
      </div>

      {loadError && (
        <div className="banner error" role="alert">
          <span>Couldn't load: {loadError}</span>
        </div>
      )}

      {tab === 'words' && (
        <WordsPanel
          entries={words}
          onChange={setWords}
          loading={words === null && !loadError}
        />
      )}
      {tab === 'phrases' && (
        <PhrasesPanel
          entries={phrases}
          onChange={setPhrases}
          onOpenSong={onOpenSong}
          loading={phrases === null && !loadError}
        />
      )}
    </main>
  )
}

function WordsPanel({
  entries,
  onChange,
  loading,
}: {
  entries: WordLookup[] | null
  onChange: (next: WordLookup[]) => void
  loading: boolean
}) {
  async function handleDelete(id: string) {
    if (!entries) return
    if (!confirm('Remove this word from your dictionary?')) return
    const snapshot = entries
    onChange(entries.filter((e) => e.id !== id))
    try {
      await deleteLookup(id)
    } catch (err) {
      console.warn('Failed to delete lookup', err)
      onChange(snapshot)
    }
  }

  if (loading) return <p className="muted">Loading…</p>
  if (!entries || entries.length === 0) {
    return (
      <p className="muted library-empty">
        No words yet. Look up a word with the <em>📖</em> button in a song
        and it will show up here.
      </p>
    )
  }
  return (
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
            {e.songTitle && <span className="muted">{e.songTitle}</span>}
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
  )
}

function PhrasesPanel({
  entries,
  onChange,
  onOpenSong,
  loading,
}: {
  entries: Phrase[] | null
  onChange: (next: Phrase[]) => void
  onOpenSong: (id: string, jumpToWordIndex?: number) => void
  loading: boolean
}) {
  async function handleDelete(id: string) {
    if (!entries) return
    if (!confirm('Remove this phrase?')) return
    const snapshot = entries
    onChange(entries.filter((p) => p.id !== id))
    try {
      await deletePhrase(id)
    } catch (err) {
      console.warn('Failed to delete phrase', err)
      onChange(snapshot)
    }
  }

  if (loading) return <p className="muted">Loading…</p>
  if (!entries || entries.length === 0) {
    return (
      <p className="muted library-empty">
        No phrases yet. Hit the <em>📌</em> button while transcribing to
        save a stretch of words.
      </p>
    )
  }
  return (
    <ul className="dictionary-list">
      {entries.map((p) => (
        <li key={p.id} className="dictionary-row">
          <div className="dictionary-word">
            <span className="dictionary-word-link">{p.text}</span>
            {p.translation && (
              <span className="dictionary-translation">
                {' — '}
                {p.translation}
              </span>
            )}
          </div>
          <div className="dictionary-meta">
            {p.songId ? (
              <button
                type="button"
                className="link small"
                onClick={() => onOpenSong(p.songId!, p.startIndex)}
                title="Open song and jump to this phrase"
              >
                {p.songTitle || '(untitled)'}
              </button>
            ) : p.songTitle ? (
              <span className="muted">{p.songTitle}</span>
            ) : null}
          </div>
          <button
            type="button"
            className="row-action danger"
            onClick={() => handleDelete(p.id)}
            aria-label="Delete phrase"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  )
}
