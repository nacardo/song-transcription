import { useMemo, useRef, useState } from 'react'
import { statusOf, tokenize } from './lyrics'
import type { Song } from './storage'

type Props = {
  song: Song
  onBack: () => void
  onEdit: () => void
}

export function Practice({ song, onBack, onEdit }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const inputRefs = useRef(new Map<number, HTMLInputElement>())

  const tokens = useMemo(() => tokenize(song.lyrics), [song.lyrics])

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
        if (statusOf(answers[token.index] ?? '', token.text) === 'correct') {
          continue
        }
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
          <h1>{song.title}</h1>
          {song.artist && <div className="song-header-artist">{song.artist}</div>}
        </div>
        <button type="button" className="link" onClick={onEdit}>
          Edit
        </button>
      </header>

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
          const status = statusOf(answer, token.text)
          const isRevealed = revealed.has(token.index)
          const stateClass = isRevealed ? 'revealed' : status
          const isFocused = focusedIndex === token.index
          return (
            <span key={i} className="word-slot">
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(token.index, el)
                  else inputRefs.current.delete(token.index)
                }}
                className={`word ${stateClass}`}
                size={Math.max(token.text.length, 2)}
                value={isRevealed ? token.text : answer}
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
                  if (e.key === '?' && !isRevealed) {
                    e.preventDefault()
                    revealWord(token.index)
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
              {isFocused && !isRevealed && (
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
              )}
            </span>
          )
        })}
      </div>

      <div className="actions">
        <button type="button" onClick={revealAll}>
          Reveal all
        </button>
      </div>
    </main>
  )
}
