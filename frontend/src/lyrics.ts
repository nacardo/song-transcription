export type Token =
  | { kind: 'word'; text: string; index: number }
  | { kind: 'gap'; text: string }
  | { kind: 'header'; text: string }

export type Status = 'empty' | 'typing' | 'wrong' | 'correct'

const WORD_TOKEN = /(\p{L}[\p{L}\p{M}'’-]*)|([^\p{L}]+)/gu
const HEADER_LINE = /^\s*\[(.+)\]\s*$/
const LETRA_TITLE = /\[\s*letra de\s+(.+?)\s*\]/i
const QUOTE_TRIM = /^["'“”‘’]+|["'“”‘’]+$/g

export function tokenize(lyrics: string): Token[] {
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

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

export function statusOf(answer: string, target: string): Status {
  const a = normalize(answer)
  if (!a) return 'empty'
  const t = normalize(target)
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
