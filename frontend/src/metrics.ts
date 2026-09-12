// Metrics aggregation: pulls the whole library + all progress in one shot,
// then folds it into the shapes the MetricsView renders. Computation is
// intentionally on the frontend so the existing tokenizer in lyrics.ts is
// the single source of truth for "what is a word" and "what counts as
// correct" — no need to port that logic to Python.

import { apiJson } from './api'
import { statusOf, tokenize } from './lyrics'
import type { Song } from './storage'

// Server shape for /api/progress (list-all) — mirrors ProgressWithSongId
// on the backend.
export type ProgressRow = {
  songId: string
  answers: Record<string, string>
  revealed: number[]
  positionMs?: number
  updatedAt: number
}

export type WordCount = {
  word: string
  count: number
}

export type Metrics = {
  uniqueWordsTranscribed: number
  // Words the user hit `?` on most often across the whole library — their
  // vocabulary weak spots, essentially. Sorted by count desc; capped at
  // MOST_REVEALED_LIMIT so the UI stays scannable.
  mostRevealedWords: WordCount[]
}

const MOST_REVEALED_LIMIT = 10

export async function listAllProgress(): Promise<ProgressRow[]> {
  return apiJson<ProgressRow[]>('/api/progress')
}

// Compute every metric the view shows. Kept as a pure function of its
// inputs so tests and future analytics can call it directly.
export function computeMetrics(
  songs: Song[],
  progresses: ProgressRow[],
): Metrics {
  const progressBySong = new Map(progresses.map((p) => [p.songId, p]))
  // Distinct correct words across every song. Lowercased so "Casa" and
  // "casa" count once; accents preserved so `canción` and `cancion` stay
  // distinct — consistent with the app's accent-training philosophy.
  const uniqueCorrect = new Set<string>()
  const revealedCounts = new Map<string, number>()

  for (const song of songs) {
    const progress = progressBySong.get(song.id)
    if (!progress) continue
    const tokens = tokenize(song.lyrics)
    // Index tokens by their word index so we can look up the actual text
    // for each revealed position without a linear scan per reveal.
    const wordByIndex = new Map<number, string>()
    for (const token of tokens) {
      if (token.kind === 'word') wordByIndex.set(token.index, token.text)
    }
    for (const token of tokens) {
      if (token.kind !== 'word') continue
      const answer = progress.answers[String(token.index)] ?? ''
      if (statusOf(answer, token.text) === 'correct') {
        uniqueCorrect.add(token.text.toLowerCase())
      }
    }
    for (const idx of progress.revealed) {
      const text = wordByIndex.get(idx)
      if (!text) continue
      const key = text.toLowerCase()
      revealedCounts.set(key, (revealedCounts.get(key) ?? 0) + 1)
    }
  }

  const mostRevealedWords: WordCount[] = Array.from(revealedCounts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, MOST_REVEALED_LIMIT)

  return {
    uniqueWordsTranscribed: uniqueCorrect.size,
    mostRevealedWords,
  }
}
