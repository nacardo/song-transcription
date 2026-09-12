import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayerControls } from './PlayerControls'
import { recordLookup } from './dictionary'
import { normalize, statusOf, tokenizeLyrics, type Token } from './lyrics'
import { savePhrase } from './phrases'
import type { Settings } from './settings'
import { playFromLine, subscribeToState } from './spotify-player'
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
  // Optional: when set, seek playback to this word's synced-lyrics timestamp
  // on mount. Used by the Vocabulary → Phrases flow so clicking a saved
  // phrase drops you into the song at the right spot.
  jumpToWordIndex?: number
}

// Save no more often than this while the user is typing — one HTTP PUT per
// keystroke is wasteful when we only care about eventual consistency.
const SAVE_DEBOUNCE_MS = 500

// How long the "phrase saved" confirmation banner sticks around.
const PHRASE_TOAST_MS = 2500

function wordReferenceUrl(word: string): string {
  // Spanish → English lookup. WordReference blocks iframe embedding, so this
  // is always opened in a new tab (see the wordreference-lookup memory).
  return `https://www.wordreference.com/es/en/translation.asp?spen=${encodeURIComponent(word)}`
}

// Fire-and-forget capture: silently records the word in the user's personal
// dictionary (backend fetches a translation asynchronously). Any failure is
// logged but never affects the user — WordReference still opens.
function captureLookup(word: string, songId: string): void {
  recordLookup({ word, display: word, songId }).catch((err) => {
    console.warn('Failed to record dictionary lookup', err)
  })
}

// Walk the token stream between two word indices (inclusive) and rebuild
// the human-readable text: word tokens plus their intervening gaps, with
// newlines collapsed to spaces. Headers are skipped so a phrase that spans
// a section boundary reads naturally.
function extractPhraseText(
  tokens: Token[],
  startWordIndex: number,
  endWordIndex: number,
): string {
  const [lo, hi] =
    startWordIndex <= endWordIndex
      ? [startWordIndex, endWordIndex]
      : [endWordIndex, startWordIndex]
  let startPos = -1
  let endPos = -1
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind !== 'word') continue
    if (t.index === lo && startPos === -1) startPos = i
    if (t.index === hi) endPos = i
  }
  if (startPos === -1 || endPos === -1) return ''
  return tokens
    .slice(startPos, endPos + 1)
    .filter((t) => t.kind !== 'header')
    .map((t) => t.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
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
  jumpToWordIndex,
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

  // Phrase-selection mode: entered via the 📌 FAB, exited on second click,
  // second word pick, or Escape. `phraseStart` remembers the first-clicked
  // word so we can compute the range on the second click.
  type PhraseMode = 'off' | 'awaiting-start' | 'awaiting-end'
  const [phraseMode, setPhraseMode] = useState<PhraseMode>('off')
  const [phraseStart, setPhraseStart] = useState<number | null>(null)
  // Transient text of the last-saved phrase — drives the confirmation
  // banner. Cleared by a timer after PHRASE_TOAST_MS.
  const [phraseSavedText, setPhraseSavedText] = useState<string | null>(null)
  const inPhraseMode = phraseMode !== 'off'

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

  // Duplicate-line detection for the auto-fill affordance. Two lines match
  // only when their full normalized word sequences are identical (same word
  // count, same normalized words, in order). This is intentionally strict so
  // a short common phrase like "yo soy" that appears inside a longer line
  // doesn't trigger cross-line fills.
  const duplicateLineIndexMap = useMemo(() => {
    const groupsByKey = new Map<string, number[]>()
    for (const { lineIndex, tokens } of linesForRender) {
      const words = tokens.filter((t) => t.kind === 'word')
      if (words.length === 0) continue
      const key = words.map((t) => normalize(t.text)).join(' ')
      const arr = groupsByKey.get(key) ?? []
      arr.push(lineIndex)
      groupsByKey.set(key, arr)
    }
    // For each line, the list of OTHER lines sharing its key. Lines that
    // aren't repeated aren't in the map at all.
    const map = new Map<number, number[]>()
    for (const [, members] of groupsByKey) {
      if (members.length < 2) continue
      for (const m of members) {
        map.set(
          m,
          members.filter((x) => x !== m),
        )
      }
    }
    return map
  }, [linesForRender])

  const songHasDuplicateLines = duplicateLineIndexMap.size > 0

  // For a given line, does it have at least one word that isn't correct yet
  // AND isn't revealed? Only such lines are candidates for filling.
  function lineHasFillableWords(lineIndex: number): boolean {
    const line = linesForRender.find((l) => l.lineIndex === lineIndex)
    if (!line) return false
    const words = line.tokens.filter((t) => t.kind === 'word')
    return words.some((t) => {
      if (revealed.has(t.index)) return false
      const answer = answers[t.index] ?? ''
      return (
        statusOf(answer, t.text, {
          requireAccents: settings.requireAccents,
        }) !== 'correct'
      )
    })
  }

  // Is every word in this line fully typed correctly? Reveals do NOT count
  // — a line that's half-revealed isn't a valid source of truth for
  // duplicating answers into a repeat.
  function lineIsFullyTypedCorrect(lineIndex: number): boolean {
    const line = linesForRender.find((l) => l.lineIndex === lineIndex)
    if (!line) return false
    const words = line.tokens.filter((t) => t.kind === 'word')
    if (words.length === 0) return false
    return words.every((t) => {
      if (revealed.has(t.index)) return false
      const answer = answers[t.index] ?? ''
      return (
        statusOf(answer, t.text, {
          requireAccents: settings.requireAccents,
        }) === 'correct'
      )
    })
  }

  // First duplicate line (by lineIndex order) that qualifies as a fill
  // source for the given target line. Null if none — button is hidden then.
  function findFillSource(targetLineIndex: number): number | null {
    if (!lineHasFillableWords(targetLineIndex)) return null
    const dupes = duplicateLineIndexMap.get(targetLineIndex)
    if (!dupes) return null
    for (const idx of dupes) {
      if (lineIsFullyTypedCorrect(idx)) return idx
    }
    return null
  }

  function fillLineFromSource(
    sourceLineIndex: number,
    targetLineIndex: number,
  ) {
    const source = linesForRender.find((l) => l.lineIndex === sourceLineIndex)
    const target = linesForRender.find((l) => l.lineIndex === targetLineIndex)
    if (!source || !target) return
    const sourceWords = source.tokens.filter((t) => t.kind === 'word')
    const targetWords = target.tokens.filter((t) => t.kind === 'word')
    // Duplicate detection already guarantees same length; belt + braces.
    if (sourceWords.length !== targetWords.length) return
    setAnswers((prev) => {
      const next = { ...prev }
      for (let k = 0; k < targetWords.length; k++) {
        const targetToken = targetWords[k]
        // Leave revealed words alone — user opted to reveal them, not fill.
        if (revealed.has(targetToken.index)) continue
        const existing = next[targetToken.index] ?? ''
        const alreadyCorrect =
          statusOf(existing, targetToken.text, {
            requireAccents: settings.requireAccents,
          }) === 'correct'
        if (alreadyCorrect) continue
        next[targetToken.index] = prev[sourceWords[k].index] ?? ''
      }
      return next
    })
  }

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

  // Jump-to-word on mount / when the parent passes a new target index.
  // No-op when the song has no synced lyrics — nothing to seek to.
  useEffect(() => {
    if (jumpToWordIndex == null) return
    if (!song.spotifyUri) return
    const token = tokens.find(
      (t) => t.kind === 'word' && t.index === jumpToWordIndex,
    )
    if (!token) return
    const line = lines[token.lineIndex]
    if (!line || line.startMs == null) return
    void playFromLine(song.spotifyUri, line.startMs)
  }, [jumpToWordIndex, tokens, lines, song.spotifyUri])

  // Phrase mode: escape at any time cancels. Only registered while active.
  useEffect(() => {
    if (!inPhraseMode) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPhraseMode('off')
        setPhraseStart(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inPhraseMode])

  function togglePhraseMode() {
    if (inPhraseMode) {
      setPhraseMode('off')
      setPhraseStart(null)
    } else {
      setPhraseMode('awaiting-start')
      setPhraseStart(null)
    }
  }

  function pickPhraseWord(wordIndex: number) {
    if (phraseMode === 'awaiting-start') {
      setPhraseStart(wordIndex)
      setPhraseMode('awaiting-end')
      return
    }
    if (phraseMode === 'awaiting-end' && phraseStart !== null) {
      const [lo, hi] =
        phraseStart <= wordIndex
          ? [phraseStart, wordIndex]
          : [wordIndex, phraseStart]
      const text = extractPhraseText(tokens, lo, hi)
      setPhraseMode('off')
      setPhraseStart(null)
      if (!text) return
      // Optimistic confirmation — banner appears the moment the click
      // registers, without waiting on the network round-trip.
      setPhraseSavedText(text)
      void savePhrase({
        text,
        songId: song.id,
        startIndex: lo,
        endIndex: hi,
      }).catch((err) => {
        console.warn('Failed to save phrase', err)
      })
    }
  }

  // Auto-dismiss the "phrase saved" banner after a short window.
  useEffect(() => {
    if (!phraseSavedText) return
    const t = window.setTimeout(
      () => setPhraseSavedText(null),
      PHRASE_TOAST_MS,
    )
    return () => window.clearTimeout(t)
  }, [phraseSavedText])

  // Click-to-seek: users hit a dedicated ▶ button in each line's left margin
  // rather than clicking the line background — the whole-line hover target
  // was fiddly and easy to hit by accident when trying to focus a word.
  // Uses playFromLine so a paused/idle player also resumes; clicking a line
  // should always end with the song playing from that point.
  function handleSeekClick(startMs: number) {
    void playFromLine(song.spotifyUri, startMs)
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
    const isPhraseStart = phraseStart === token.index
    // In phrase mode we hijack the input: prevent focus (so no caret /
    // typing distraction), and forward the click to phrase-pick. Everything
    // else stays wired to the normal handlers when phrase mode is off.
    const phraseInputProps = inPhraseMode
      ? {
          readOnly: true,
          onMouseDown: (e: React.MouseEvent<HTMLInputElement>) =>
            e.preventDefault(),
          onClick: () => pickPhraseWord(token.index),
        }
      : {
          readOnly: isRevealed,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setAnswers((prev) => ({
              ...prev,
              [token.index]: e.target.value,
            })),
          onFocus: () => setFocusedIndex(token.index),
          onBlur: () =>
            setFocusedIndex((cur) => (cur === token.index ? null : cur)),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === '?') {
              e.preventDefault()
              if (!isRevealed && status !== 'correct') {
                revealWord(token.index)
              }
            } else if (e.key === ' ') {
              e.preventDefault()
              focusNextWord(token.index)
            }
          },
        }
    return (
      <span key={keyIdx} className="word-slot">
        <input
          ref={(el) => {
            if (el) inputRefs.current.set(token.index, el)
            else inputRefs.current.delete(token.index)
          }}
          className={`word ${stateClass}${isPhraseStart ? ' phrase-start' : ''}`}
          size={Math.max(token.text.length, 2)}
          value={displayValue}
          aria-label={`Word ${token.index + 1}`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          {...phraseInputProps}
        />
        {!inPhraseMode &&
          isFocused &&
          (isRevealed || status === 'correct' ? (
            <button
              type="button"
              tabIndex={-1}
              className="lookup-hint"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                captureLookup(token.text, song.id)
                window.open(
                  wordReferenceUrl(token.text),
                  '_blank',
                  'noopener,noreferrer',
                )
              }}
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

      {inPhraseMode && (
        <div className="phrase-banner" role="status">
          {phraseMode === 'awaiting-start'
            ? 'Click the first word of your phrase.'
            : 'Now click the last word.'}
          <button
            type="button"
            className="link small"
            onClick={togglePhraseMode}
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {phraseSavedText && !inPhraseMode && (
        <div className="phrase-banner saved" role="status">
          <span>
            ✓ Saved phrase: <em>{phraseSavedText}</em>
          </span>
          <button
            type="button"
            className="link small"
            onClick={() => setPhraseSavedText(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className={`lyrics${inPhraseMode ? ' phrase-mode' : ''}`}>
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
          const fillSource = songHasDuplicateLines
            ? findFillSource(lineIndex)
            : null
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
              {/* Reserve the fill column only when the song has any
                  duplicate lines — otherwise it's just wasted margin. */}
              {songHasDuplicateLines &&
                (fillSource !== null ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="lyric-fill"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => fillLineFromSource(fillSource, lineIndex)}
                    aria-label="Fill this line from an earlier repeat"
                    title="Fill this line from an earlier repeat"
                  >
                    🔁
                  </button>
                ) : (
                  <span className="lyric-fill placeholder" aria-hidden="true" />
                ))}
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

      {/* Floating action button for phrase mode — fixed to the viewport so
          it's reachable without scrolling. Renders on every song regardless
          of whether Spotify is connected (unlike the player bar). */}
      <button
        type="button"
        className={`phrase-fab${inPhraseMode ? ' active' : ''}`}
        onClick={togglePhraseMode}
        aria-label={inPhraseMode ? 'Cancel phrase selection' : 'Save a phrase'}
        title={inPhraseMode ? 'Cancel phrase selection' : 'Save a phrase'}
      >
        {inPhraseMode ? '✕' : '📌'}
      </button>
    </main>
  )
}
