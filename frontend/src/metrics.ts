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

export type SongCompletion = {
  songId: string
  title: string
  artist: string
  totalWords: number
  correctWords: number
  revealedWords: number
  // correctWords / totalWords, 0..100. Revealed words don't count toward
  // completion — a reveal is a hint, not a solve.
  completionPct: number
}

export type Metrics = {
  // Every correct answer across every song, counted with multiplicity. A
  // word that appears three times in one song contributes 3 if you got
  // all three right; also counted separately per song.
  totalWordsTranscribed: number
  uniqueWordsTranscribed: number
  // Words the user hit `?` on most often across the whole library — their
  // vocabulary weak spots, essentially. Sorted by count desc; capped at
  // MOST_REVEALED_LIMIT so the UI stays scannable.
  mostRevealedWords: WordCount[]
  // One row per song, sorted by completion desc so the closest-to-done
  // sit at the top.
  perSongCompletion: SongCompletion[]
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
  const perSongCompletion: SongCompletion[] = []

  for (const song of songs) {
    const progress = progressBySong.get(song.id)
    const tokens = tokenize(song.lyrics)
    // Index tokens by their word index so we can look up the actual text
    // for each revealed position without a linear scan per reveal.
    const wordByIndex = new Map<number, string>()
    for (const token of tokens) {
      if (token.kind === 'word') wordByIndex.set(token.index, token.text)
    }
    const totalWords = wordByIndex.size
    let correctWords = 0
    let revealedWords = 0

    if (progress) {
      for (const token of tokens) {
        if (token.kind !== 'word') continue
        const answer = progress.answers[String(token.index)] ?? ''
        if (statusOf(answer, token.text) === 'correct') {
          correctWords++
          uniqueCorrect.add(token.text.toLowerCase())
        }
      }
      for (const idx of progress.revealed) {
        const text = wordByIndex.get(idx)
        if (!text) continue
        revealedWords++
        const key = text.toLowerCase()
        revealedCounts.set(key, (revealedCounts.get(key) ?? 0) + 1)
      }
    }

    perSongCompletion.push({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      totalWords,
      correctWords,
      revealedWords,
      completionPct: totalWords === 0 ? 0 : (correctWords / totalWords) * 100,
    })
  }

  // Closest-to-done at the top; ties broken by title so the ordering is
  // stable across renders.
  perSongCompletion.sort(
    (a, b) => b.completionPct - a.completionPct || a.title.localeCompare(b.title),
  )

  const mostRevealedWords: WordCount[] = Array.from(revealedCounts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, MOST_REVEALED_LIMIT)

  const totalWordsTranscribed = perSongCompletion.reduce(
    (sum, row) => sum + row.correctWords,
    0,
  )

  return {
    totalWordsTranscribed,
    uniqueWordsTranscribed: uniqueCorrect.size,
    mostRevealedWords,
    perSongCompletion,
  }
}
