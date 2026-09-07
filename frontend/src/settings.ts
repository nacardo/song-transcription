import { apiFetch, apiJson } from './api'

export type Settings = {
  requireAccents: boolean
  rewindOnResumeSeconds: number
}

// Defaults mirror the backend defaults; used as a fallback during in-flight
// optimistic updates.
export const DEFAULTS: Settings = {
  requireAccents: false,
  rewindOnResumeSeconds: 2,
}

const API = '/api/settings'

export async function getSettings(): Promise<Settings> {
  return apiJson<Settings>(API)
}

export async function saveSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  return apiJson<Settings>(API, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// One-shot migration for the localStorage settings blob.
const LEGACY_KEY = 'song-transcription:settings'
const MIGRATION_FLAG = 'song-transcription:migrated:settings-v1'

export async function migrateLegacySettingsIfNeeded(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return
  const raw = localStorage.getItem(LEGACY_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const patch: Partial<Settings> = {}
        if (typeof parsed.requireAccents === 'boolean') {
          patch.requireAccents = parsed.requireAccents
        }
        if (typeof parsed.rewindOnResumeSeconds === 'number') {
          patch.rewindOnResumeSeconds = parsed.rewindOnResumeSeconds
        }
        if (Object.keys(patch).length > 0) {
          const res = await apiFetch(API, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          })
          if (!res.ok) {
            console.warn(`Settings migration PATCH failed: ${res.status}`)
          }
        }
      }
    } catch {
      /* corrupt legacy data — just skip */
    }
  }
  localStorage.setItem(MIGRATION_FLAG, '1')
}
