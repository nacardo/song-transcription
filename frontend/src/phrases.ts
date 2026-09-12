// Frontend client for /api/phrases — multi-word stretches the user has
// saved (parallel to dictionary.ts for single-word lookups).

import { apiFetch, apiJson } from './api'

export type Phrase = {
  id: string
  text: string
  translation: string
  translationSource: string
  songId: string | null
  songTitle: string
  startIndex: number
  endIndex: number
  savedAt: number
}

const API = '/api/phrases'

export async function listPhrases(): Promise<Phrase[]> {
  return apiJson<Phrase[]>(API)
}

export async function savePhrase(input: {
  text: string
  songId?: string | null
  startIndex: number
  endIndex: number
}): Promise<Phrase> {
  return apiJson<Phrase>(API, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deletePhrase(id: string): Promise<void> {
  await apiFetch(`${API}/${id}`, { method: 'DELETE' })
}
