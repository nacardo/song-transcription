import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayerControls } from './PlayerControls'
import { statusOf, tokenize } from './lyrics'
import type { Settings } from './settings'
import { subscribeToState } from './spotify-player'
import {
  clearProgress,
  getProgress,
  saveProgress,
  type Progress,
  type Song,
} from './storage'

type Props = {
  song: Song
  settings: Settings
  onBack: () => void
  onEdit: () => void
}

// Save no more often than this while the user is typing — one HTTP PUT per
// keystroke is wasteful when we only care about eventual consistency.
const SAVE_DEBOUNCE_MS = 500

function wordReferenceUrl(word: string): string {
  // Spanish → English lookup. WordReference blocks iframe embedding, so this
  // is always opened in a new tab (see the wordreference-lookup memory).
  return `https://www.wordreference.com/es/en/translation.asp?spen=${encodeURIComponent(word)}`
}

// Practice hydrates progress from the backend before rendering the main UI.
// Otherwise the user could type into an empty input for a beat, then have the
// fetched progress overwrite their answers on arrival.
export function Practice(props: Props) {
  const [loaded, setLoaded] = useState<
    | { state: 'loading' }
    | { state: 'ready'; initial: Progress | undefined }
    | { state: 'error'; message: string }
  >({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoaded({ state: 'loading' })
    getProgress(props.song.id)
      .then((p) => {
        if (!cancelled) setLoaded({ state: 'ready', initial: p })
      })
      .catch((err: unknown) => {
        // Treat as empty; the user can still practice, we just lose resume state.
        console.warn('Failed to load progress', err)
        if (!cancelled) {
          setLoaded({
            state: 'error',
            message: `Couldn't load saved progress: ${err}`,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.song.id])

  if (loaded.state === 'loading') {
    return (
      <main>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  const initial = loaded.state === 'ready' ? loaded.initial : undefined
  return (
    <PracticeReady
      key={props.song.id}
      {...props}
      initial={initial}
      loadError={loaded.state === 'error' ? loaded.message : null}
    />
  )
}

type ReadyProps = Props & {
  initial: Progress | undefined
  loadError: string | null
}

function PracticeReady({
  song,
  settings,
  onBack,
  onEdit,
  initial,
  loadError,
}: ReadyProps) {
  const [answers, setAnswers] = useState<Record<number, string>>(
    initial?.answers ?? {},
  )
  const [revealed, setRevealed] = useState<Set<number>>(
    new Set(initial?.revealed ?? []),
  )
  const [positionMs, setPositionMs] = useState<number | undefined>(
    initial?.positionMs,
  )
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const inputRefs = useRef(new Map<number, HTMLInputElement>())

  const tokens = useMemo(() => tokenize(song.lyrics), [song.lyrics])

  // Debounced save: clear pending write on each change, save 500 ms after the
  // last change. `void` because we don't await inside an effect.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void saveProgress(song.id, {
        answers,
        revealed: Array.from(revealed),
        positionMs,
      })
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [song.id, answers, revealed, positionMs])

  // Flush the latest values on unmount so navigating away doesn't lose the
  // in-flight debounced write. Ref keeps the latest snapshot without
  // re-registering the cleanup on every change.
  const latestRef = useRef({ answers, revealed, positionMs })
  latestRef.current = { answers, revealed, positionMs }
  useEffect(() => {
    return () => {
      void saveProgress(song.id, {
        answers: latestRef.current.answers,
        revealed: Array.from(latestRef.current.revealed),
        positionMs: latestRef.current.positionMs,
      })
    }
  }, [song.id])

  // Track playback position for the current song. We only capture positions
  // for our track (not something else the user has playing on Spotify), and
  // throttle updates so we don't churn state 4× a second.
  useEffect(() => {
    let lastCapture = 0
    let wasPlaying = false
    const unsub = subscribeToState((state) => {
      if (!state || state.trackUri !== song.spotifyUri) return
      const transition = wasPlaying !== state.isPlaying
      wasPlaying = state.isPlaying
      const now = Date.now()
      if (transition || (state.isPlaying && now - lastCapture >= 2000)) {
        lastCapture = now
        setPositionMs(state.position)
      }
    })
    return unsub
  }, [song.spotifyUri])

  async function resetProgress() {
    if (!confirm('Reset progress for this song?')) return
    setAnswers({})
    setRevealed(new Set())
    setPositionMs(undefined)
    try {
      await clearProgress(song.id)
    } catch (err) {
      console.warn('Failed to clear progress on server', err)
    }
  }

  function focusNextWord(fromIndex: number) {
    let target = fromIndex + 1
    while (inputRefs.current.has(target)) {
      const el = inputRefs.current.get(target)!
      if (!el.readOnly) {
        el.focus()
        return
      }
      target++
    }
  }

  function revealWord(index: number) {
    setRevealed((prev) => {
      if (prev.has(index)) return prev
      const next = new Set(prev)
      next.add(index)
      return next
    })
  }

  function revealAll() {
    setRevealed(() => {
      const next = new Set<number>()
      for (const token of tokens) {
        if (token.kind !== 'word') continue
        const s = statusOf(answers[token.index] ?? '', token.text, {
          requireAccents: settings.requireAccents,
        })
        if (s === 'correct') continue
        next.add(token.index)
      }
      return next
    })
  }

  return (
    <main>
      <header className="song-header">
        <button type="button" className="link" onClick={onBack}>
          ← Library
        </button>
        <div className="song-header-title">
          {song.albumArtUrl && (
            <img
              className="song-header-cover"
              src={song.albumArtUrl}
              alt=""
              aria-hidden="true"
            />
          )}
          <div className="song-header-text">
            <h1>{song.title}</h1>
            {song.artist && (
              <div className="song-header-artist">{song.artist}</div>
            )}
          </div>
          {/* Invisible spacer that mirrors the cover so the text stays
              centered where it sat before the art was added. */}
          {song.albumArtUrl && (
            <span className="song-header-cover-spacer" aria-hidden="true" />
          )}
        </div>
        <button type="button" className="link" onClick={onEdit}>
          Edit
        </button>
      </header>

      {loadError && (
        <div className="banner error" role="alert">
          <span>{loadError}</span>
        </div>
      )}

      {song.spotifyUri && (
        <PlayerControls
          spotifyUri={song.spotifyUri}
          initialPositionMs={initial?.positionMs}
        />
      )}

      <div className="lyrics">
        {tokens.map((token, i) => {
          if (token.kind === 'gap') {
            return <span key={i}>{token.text}</span>
          }
          if (token.kind === 'header') {
            return (
              <h2 key={i} className="section">
                {token.text}
              </h2>
            )
          }
          const answer = answers[token.index] ?? ''
          const status = statusOf(answer, token.text, {
            requireAccents: settings.requireAccents,
          })
          const isRevealed = revealed.has(token.index)
          const stateClass = isRevealed ? 'revealed' : status
          const isFocused = focusedIndex === token.index
          // When the answer is correct, show the canonical form (with accents,
          // capitalization, etc.) so the user sees the right spelling even if
          // they typed the diacritic-free version. Note: correctness currently
          // ignores diacritics — a future "strict accents" toggle would change
          // statusOf(), and this display swap would still do the right thing.
          const displayValue =
            isRevealed || status === 'correct' ? token.text : answer
          return (
            <span key={i} className="word-slot">
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(token.index, el)
                  else inputRefs.current.delete(token.index)
                }}
                className={`word ${stateClass}`}
                size={Math.max(token.text.length, 2)}
                value={displayValue}
                readOnly={isRevealed}
                onChange={(e) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [token.index]: e.target.value,
                  }))
                }
                onFocus={() => setFocusedIndex(token.index)}
                onBlur={() =>
                  setFocusedIndex((cur) =>
                    cur === token.index ? null : cur,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === '?') {
                    e.preventDefault()
                    if (!isRevealed && status !== 'correct') {
                      revealWord(token.index)
                    }
                  } else if (e.key === ' ') {
                    e.preventDefault()
                    focusNextWord(token.index)
                  }
                }}
                aria-label={`Word ${token.index + 1}`}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {isFocused &&
                (isRevealed || status === 'correct' ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="lookup-hint"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      window.open(
                        wordReferenceUrl(token.text),
                        '_blank',
                        'noopener,noreferrer',
                      )
                    }
                    aria-label={`Look up "${token.text}" on WordReference`}
                    title={`Look up "${token.text}" on WordReference`}
                  >
                    📖
                  </button>
                ) : (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="reveal-hint"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => revealWord(token.index)}
                    aria-label={`Reveal word ${token.index + 1}`}
                    title="Reveal this word (?)"
                  >
                    ?
                  </button>
                ))}
            </span>
          )
        })}
      </div>

      <div className="actions">
        <button type="button" onClick={revealAll}>
          Reveal all
        </button>
        <button type="button" onClick={resetProgress}>
          Reset progress
        </button>
      </div>
    </main>
  )
}
