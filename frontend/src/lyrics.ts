export type Token =
  | { kind: 'word'; text: string; index: number; lineIndex: number }
  | { kind: 'gap'; text: string; lineIndex: number }
  | { kind: 'header'; text: string; lineIndex: number }

// A line in the tokenized output. `startMs` is present when the line was
// derived from an LRC source (or aligned to one); undefined otherwise. Phases
// 3/4 use it for click-to-seek and current-line highlighting.
export type LineInfo = {
  index: number
  startMs?: number
}

export type Tokenized = {
  tokens: Token[]
  lines: LineInfo[]
}

export type Status = 'empty' | 'typing' | 'wrong' | 'correct'

const WORD_TOKEN = /(\p{L}[\p{L}\p{M}'’-]*)|([^\p{L}]+)/gu
const HEADER_LINE = /^\s*\[(.+)\]\s*$/
const LETRA_TITLE = /\[\s*letra de\s+(.+?)\s*\]/i
const QUOTE_TRIM = /^["'“”‘’]+|["'“”‘’]+$/g
// LRC prefix timestamp: [mm:ss] or [mm:ss.xx] / [mm:ss.xxx]. Anchored via
// exec loop below (so `g` is intentional).
const LRC_TIMESTAMP = /\[(\d+):(\d+(?:\.\d+)?)\]/g

// Backwards-compatible tokenizer for plain lyrics. Returns just the tokens
// array (with lineIndex on each token — new callers should prefer
// tokenizeLyrics(), which also returns line info).
export function tokenize(lyrics: string): Token[] {
  return tokenizeLyrics({ lyrics }).tokens
}

// Tokenize with optional LRC-derived line timing. When `syncedLyrics` is
// present it's the source of truth: we tokenize each LRC line's text and
// attach its timestamp. Otherwise we fall back to line-splitting the plain
// `lyrics` field, and every line has an undefined `startMs`.
export function tokenizeLyrics(input: {
  lyrics: string
  syncedLyrics?: string
}): Tokenized {
  if (input.syncedLyrics && input.syncedLyrics.trim().length > 0) {
    return tokenizeFromLrc(input.syncedLyrics)
  }
  return tokenizeFromPlain(input.lyrics)
}

function tokenizeFromPlain(lyrics: string): Tokenized {
  const rawLines = lyrics.split('\n')
  const linesInfo: LineInfo[] = rawLines.map((_text, i) => ({ index: i }))
  return { tokens: tokenizeLineList(rawLines), lines: linesInfo }
}

function tokenizeFromLrc(lrc: string): Tokenized {
  const parsed = parseLrc(lrc)
  const lineTexts = parsed.map((p) => p.text)
  const lines: LineInfo[] = parsed.map((p, i) => ({
    index: i,
    startMs: p.startMs,
  }))
  return { tokens: tokenizeLineList(lineTexts), lines }
}

// Shared word/gap/header pass over an already-split list of line strings.
// Emits a trailing '\n' gap between lines to preserve the original render
// behavior (white-space: pre-wrap in the DOM).
function tokenizeLineList(rawLines: string[]): Token[] {
  const tokens: Token[] = []
  let wordIndex = 0
  rawLines.forEach((line, lineIndex) => {
    const headerMatch = line.match(HEADER_LINE)
    const isLast = lineIndex === rawLines.length - 1
    if (headerMatch) {
      tokens.push({
        kind: 'header',
        text: headerMatch[1].trim(),
        lineIndex,
      })
    } else {
      for (const match of line.matchAll(WORD_TOKEN)) {
        if (match[1] !== undefined) {
          tokens.push({
            kind: 'word',
            text: match[1],
            index: wordIndex++,
            lineIndex,
          })
        } else {
          tokens.push({ kind: 'gap', text: match[2], lineIndex })
        }
      }
    }
    if (!isLast) tokens.push({ kind: 'gap', text: '\n', lineIndex })
  })
  return tokens
}

// Parse an LRC-format string into an ordered list of lines with timestamps.
// Skips metadata lines (`[ar:...]`, `[ti:...]`, `[length:...]`, etc.) that
// have no timing prefix. When a line carries multiple timestamps (LRC's way
// of marking a repeat), we take the first — Phase 4 can build a separate
// timeline from all of them if the UI needs to highlight the current
// occurrence.
export function parseLrc(
  lrc: string,
): Array<{ startMs: number; text: string }> {
  const result: Array<{ startMs: number; text: string }> = []
  for (const raw of lrc.split(/\r?\n/)) {
    const timestamps: number[] = []
    let cursor = 0
    LRC_TIMESTAMP.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = LRC_TIMESTAMP.exec(raw)) !== null) {
      // Only consume timestamps that sit at the very start (or immediately
      // after another timestamp) — anything mid-line isn't a prefix.
      if (m.index !== cursor) break
      const mins = parseInt(m[1], 10)
      const secs = parseFloat(m[2])
      timestamps.push(Math.round((mins * 60 + secs) * 1000))
      cursor = m.index + m[0].length
    }
    if (timestamps.length === 0) continue
    const text = raw.slice(cursor)
    result.push({ startMs: timestamps[0], text })
  }
  // Sort by time in case the file has out-of-order entries.
  result.sort((a, b) => a.startMs - b.startMs)
  return result
}

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

// Case-insensitive but diacritic-preserving: for strict-accent mode, `canción`
// and `Canción` still match, but `cancion` does not.
function normalizeStrict(value: string): string {
  return value.normalize('NFC').toLowerCase().trim()
}

export type StatusOptions = {
  // When true, accent marks must match exactly for a word to count as correct.
  requireAccents?: boolean
}

export function statusOf(
  answer: string,
  target: string,
  opts?: StatusOptions,
): Status {
  const norm = opts?.requireAccents ? normalizeStrict : normalize
  const a = norm(answer)
  if (!a) return 'empty'
  const t = norm(target)
  if (a === t) return 'correct'
  if (t.startsWith(a)) return 'typing'
  return 'wrong'
}

// Extracts the title from a "[Letra de "…"]"-style header if present.
// Returns null if the pattern isn't found — callers should ask the user.
export function extractTitle(lyrics: string): string | null {
  const m = lyrics.match(LETRA_TITLE)
  if (!m) return null
  const stripped = m[1].replace(QUOTE_TRIM, '').trim()
  return stripped || null
}
