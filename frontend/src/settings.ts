export type Settings = {
  requireAccents: boolean
  rewindOnResumeSeconds: number
}

// Defaults mirror the backend defaults; used until the initial fetch lands
// and as a fallback if the backend is unreachable.
export const DEFAULTS: Settings = {
  requireAccents: false,
  rewindOnResumeSeconds: 2,
}

const API = '/api/settings'

export async function getSettings(): Promise<Settings> {
  const res = await fetch(API, { credentials: 'include' })
  if (!res.ok) throw new Error(`GET ${API} failed: ${res.status}`)
  return (await res.json()) as Settings
}

export async function saveSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const res = await fetch(API, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`PATCH ${API} failed: ${res.status}`)
  return (await res.json()) as Settings
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
        // Send only known fields; unknown keys the old client wrote get dropped.
        const patch: Partial<Settings> = {}
        if (typeof parsed.requireAccents === 'boolean') {
          patch.requireAccents = parsed.requireAccents
        }
        if (typeof parsed.rewindOnResumeSeconds === 'number') {
          patch.rewindOnResumeSeconds = parsed.rewindOnResumeSeconds
        }
        if (Object.keys(patch).length > 0) {
          await saveSettings(patch)
        }
      }
    } catch {
      /* corrupt legacy data — just skip */
    }
  }
  localStorage.setItem(MIGRATION_FLAG, '1')
}
