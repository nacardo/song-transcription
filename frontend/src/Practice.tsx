import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayerControls } from './PlayerControls'
import { statusOf, tokenizeLyrics, type Token } from './lyrics'
import type { Settings } from './settings'
import { seekTo, subscribeToState } from './spotify-player'
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

  // Prefer LRC-derived tokens when we have synced lyrics; `lines[].startMs`
  // drives click-to-seek below. Falls back to plain-lyrics tokenization
  // (with all-undefined startMs) when no LRC is available.
  const { tokens, lines } = useMemo(
    () => tokenizeLyrics({ lyrics: song.lyrics, syncedLyrics: song.syncedLyrics }),
    [song.lyrics, song.syncedLyrics],
  )
  // Bucket tokens by lineIndex so we can render each line as its own
  // clickable block. The `\n` gaps that separated inline lines are dropped
  // here — block-level `.lyric-line` divs create the visual newline for us.
  const linesForRender = useMemo(() => {
    const groups = new Map<number, Token[]>()
    for (const token of tokens) {
      if (token.kind === 'gap' && token.text === '\n') continue
      const arr = groups.get(token.lineIndex) ?? []
      arr.push(token)
      groups.set(token.lineIndex, arr)
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([lineIndex, tokens]) => ({
        lineIndex,
        tokens,
        startMs: lines[lineIndex]?.startMs,
      }))
  }, [tokens, lines])

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

  // Click-to-seek: users hit a dedicated ▶ button in each line's left margin
  // rather than clicking the line background — the whole-line hover target
  // was fiddly and easy to hit by accident when trying to focus a word.
  function handleSeekClick(startMs: number) {
    void seekTo(startMs)
  }

  // Render a single token — extracted so the per-line render stays legible.
  // Kept as a closure so it can read the state above without threading a
  // half-dozen props through a component boundary.
  function renderToken(token: Token, keyIdx: number) {
    if (token.kind === 'gap') {
      return <span key={keyIdx}>{token.text}</span>
    }
    if (token.kind === 'header') {
      return (
        <h2 key={keyIdx} className="section">
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
    // they typed the diacritic-free version.
    const displayValue =
      isRevealed || status === 'correct' ? token.text : answer
    return (
      <span key={keyIdx} className="word-slot">
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
        {linesForRender.map(({ lineIndex, tokens, startMs }) => {
          // Section-header lines aren't timed and get no line wrapper — they
          // render as standalone <h2>s to preserve today's block spacing.
          if (tokens.length === 1 && tokens[0].kind === 'header') {
            return (
              <h2 key={lineIndex} className="section">
                {tokens[0].text}
              </h2>
            )
          }
          const seekable = startMs !== undefined
          return (
            <div
              key={lineIndex}
              className={`lyric-line${seekable ? ' seekable' : ''}`}
            >
              {seekable ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="lyric-seek"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSeekClick(startMs!)}
                  aria-label="Jump playback to this line"
                  title="Jump playback to this line"
                >
                  ▶
                </button>
              ) : (
                <span className="lyric-seek placeholder" aria-hidden="true" />
              )}
              <span className="lyric-line-text">
                {tokens.map((token, i) => renderToken(token, i))}
              </span>
            </div>
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
