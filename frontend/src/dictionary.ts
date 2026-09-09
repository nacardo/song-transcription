// Frontend client for /api/dictionary — words the user has looked up on
// WordReference, with best-effort translations pulled server-side.

import { apiFetch, apiJson } from './api'

export type WordLookup = {
  id: string
  word: string
  display: string
  translation: string
  translationSource: string
  songId: string | null
  songTitle: string
  lookedUpAt: number
}

const API = '/api/dictionary'

export async function listLookups(): Promise<WordLookup[]> {
  return apiJson<WordLookup[]>(API)
}

export async function recordLookup(input: {
  word: string
  display?: string
  songId?: string | null
}): Promise<WordLookup> {
  return apiJson<WordLookup>(API, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteLookup(id: string): Promise<void> {
  await apiFetch(`${API}/${id}`, { method: 'DELETE' })
}
