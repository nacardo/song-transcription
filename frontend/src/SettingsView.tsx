import type { Settings } from './settings'

type Props = {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onBack: () => void
  onLogout: () => void
}

export function SettingsView({ settings, onChange, onBack, onLogout }: Props) {
  return (
    <main>
      <header className="song-header">
        <button type="button" className="link" onClick={onBack}>
          ← Library
        </button>
        <div className="song-header-title">
          <h1>Settings</h1>
        </div>
        <span aria-hidden="true" />
      </header>

      <ul className="settings-list">
        <li className="setting-row">
          <div className="setting-info">
            <label htmlFor="require-accents" className="setting-label">
              Require accents
            </label>
            <div className="setting-help">
              When on, words are only correct if accent marks match exactly.
              For example, <em>cancion</em> won't count for <em>canción</em>.
            </div>
          </div>
          <label className="switch">
            <input
              id="require-accents"
              type="checkbox"
              checked={settings.requireAccents}
              onChange={(e) =>
                onChange({ requireAccents: e.target.checked })
              }
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </li>
      </ul>

      <div className="actions">
        <button type="button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </main>
  )
}
