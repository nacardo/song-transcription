export type Settings = {
  requireAccents: boolean
  rewindOnResumeSeconds: number
}

// Defaults are the shipping behavior — new fields added here will start
// applying to existing users on next load without needing a migration.
export const DEFAULTS: Settings = {
  requireAccents: false,
  rewindOnResumeSeconds: 2,
}

const KEY = 'song-transcription:settings'

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }
    return { ...DEFAULTS, ...(parsed as Partial<Settings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}
