import { useMemo, useRef, useState } from 'react'
import './App.css'

type Token =
  | { kind: 'word'; text: string; index: number }
  | { kind: 'gap'; text: string }
  | { kind: 'header'; text: string }

const WORD_TOKEN = /(\p{L}[\p{L}\p{M}'’-]*)|([^\p{L}]+)/gu
const HEADER_LINE = /^\s*\[(.+)\]\s*$/

function tokenize(lyrics: string): Token[] {
  const tokens: Token[] = []
  let wordIndex = 0
  const lines = lyrics.split('\n')
  lines.forEach((line, i) => {
    const headerMatch = line.match(HEADER_LINE)
    const isLast = i === lines.length - 1
    if (headerMatch) {
      tokens.push({ kind: 'header', text: headerMatch[1].trim() })
      return
    }
    for (const match of line.matchAll(WORD_TOKEN)) {
      if (match[1] !== undefined) {
        tokens.push({ kind: 'word', text: match[1], index: wordIndex++ })
      } else {
        tokens.push({ kind: 'gap', text: match[2] })
      }
    }
    if (!isLast) tokens.push({ kind: 'gap', text: '\n' })
  })
  return tokens
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

type Status = 'empty' | 'typing' | 'wrong' | 'correct'

function statusOf(answer: string, target: string): Status {
  const a = normalize(answer)
  if (!a) return 'empty'
  const t = normalize(target)
  if (a === t) return 'correct'
  if (t.startsWith(a)) return 'typing'
  return 'wrong'
}

export default function App() {
  const [lyrics, setLyrics] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const inputRefs = useRef(new Map<number, HTMLInputElement>())

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

  const tokens = useMemo(
    () => (submitted ? tokenize(submitted) : []),
    [submitted],
  )

  function start() {
    const trimmed = lyrics.trim()
    if (!trimmed) return
    setSubmitted(trimmed)
    setAnswers({})
    setRevealed(new Set())
    setFocusedIndex(null)
  }

  function reset() {
    setSubmitted(null)
    setAnswers({})
    setRevealed(new Set())
    setFocusedIndex(null)
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

  if (!submitted) {
    return (
      <main>
        <h1>Song Transcription</h1>
        <label htmlFor="lyrics">Paste the song lyrics</label>
        <textarea
          id="lyrics"
          rows={16}
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Paste lyrics here..."
          autoFocus
        />
        <button type="button" onClick={start} disabled={!lyrics.trim()}>
          Start
        </button>
      </main>
    )
  }

  return (
    <main>
      <h1>Song Transcription</h1>
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
        <button type="button" onClick={reset}>
          New song
        </button>
      </div>
    </main>
  )
}
