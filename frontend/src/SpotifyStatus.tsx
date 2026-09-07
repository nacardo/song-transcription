import { useEffect, useState } from 'react'
import {
  beginLogin,
  clearTokens,
  fetchProfile,
  isAuthenticated,
  isConfigured,
  type SpotifyProfile,
} from './spotify-auth'

type Props = {
  onChange?: () => void
}

export function SpotifyStatus({ onChange }: Props) {
  const [profile, setProfile] = useState<SpotifyProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) return
    let cancelled = false
    setLoading(true)
    fetchProfile()
      .then((p) => {
        if (!cancelled) setProfile(p)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!isConfigured()) {
    return (
      <span className="spotify-status muted">
        Spotify: set VITE_SPOTIFY_CLIENT_ID
      </span>
    )
  }

  if (!isAuthenticated()) {
    return (
      <button type="button" className="link" onClick={() => beginLogin()}>
        Connect Spotify
      </button>
    )
  }

  return (
    <span className="spotify-status">
      <span className="spotify-dot" aria-hidden="true" />
      <span>
        {loading && !profile ? 'Spotify…' : `Spotify: ${profile?.displayName ?? '…'}`}
      </span>
      <button
        type="button"
        className="link small"
        onClick={() => {
          clearTokens()
          setProfile(null)
          onChange?.()
        }}
      >
        Disconnect
      </button>
      {error && <span className="error">{error}</span>}
    </span>
  )
}
