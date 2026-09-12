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

export type Metrics = {
  uniqueWordsTranscribed: number
}

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

  for (const song of songs) {
    const progress = progressBySong.get(song.id)
    if (!progress) continue
    const tokens = tokenize(song.lyrics)
    for (const token of tokens) {
      if (token.kind !== 'word') continue
      const answer = progress.answers[String(token.index)] ?? ''
      if (statusOf(answer, token.text) === 'correct') {
        uniqueCorrect.add(token.text.toLowerCase())
      }
    }
  }

  return {
    uniqueWordsTranscribed: uniqueCorrect.size,
  }
}
