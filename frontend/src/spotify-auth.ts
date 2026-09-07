// Spotify OAuth 2.0 with PKCE (secretless flow for browsers).
// Docs: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ')

const TOKEN_KEY = 'song-transcription:spotify-tokens'
const VERIFIER_KEY = 'song-transcription:spotify-verifier'
const STATE_KEY = 'song-transcription:spotify-state'
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

export type SpotifyTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type SpotifyProfile = {
  id: string
  displayName: string
  email: string
}

function redirectUri(): string {
  return `${window.location.origin}/callback`
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function generatePkce() {
  const verifierBytes = new Uint8Array(64)
  crypto.getRandomValues(verifierBytes)
  const verifier = base64UrlEncode(verifierBytes)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

export function isConfigured(): boolean {
  return !!CLIENT_ID
}

export function getTokens(): SpotifyTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as SpotifyTokens) : null
  } catch {
    return null
  }
}

function setTokens(tokens: SpotifyTokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return !!getTokens()
}

export async function beginLogin(): Promise<void> {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set')
  const { verifier, challenge } = await generatePkce()
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES,
  })
  window.location.href = `${AUTHORIZE_URL}?${params.toString()}`
}

export async function completeLogin(): Promise<SpotifyTokens> {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set')
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const err = params.get('error')
  if (err) throw new Error(`Spotify auth error: ${err}`)
  if (!code) throw new Error('Missing authorization code in callback')
  const expected = sessionStorage.getItem(STATE_KEY)
  if (!state || state !== expected) throw new Error('OAuth state mismatch')
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!verifier) throw new Error('Missing PKCE verifier')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  })
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  const tokens: SpotifyTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  setTokens(tokens)
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  return tokens
}

export async function refreshTokens(): Promise<SpotifyTokens> {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set')
  const current = getTokens()
  if (!current) throw new Error('Not authenticated')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) {
    clearTokens()
    throw new Error(`Refresh failed: ${res.status}`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  const tokens: SpotifyTokens = {
    accessToken: data.access_token,
    // Spotify usually reuses the same refresh_token; keep the old one if omitted.
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  setTokens(tokens)
  return tokens
}

// Returns an access token that has at least 60 s of validity left,
// refreshing silently if we're close to expiry.
export async function getValidAccessToken(): Promise<string> {
  const t = getTokens()
  if (!t) throw new Error('Not authenticated')
  if (Date.now() > t.expiresAt - 60_000) {
    const refreshed = await refreshTokens()
    return refreshed.accessToken
  }
  return t.accessToken
}

export async function fetchProfile(): Promise<SpotifyProfile> {
  const token = await getValidAccessToken()
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`)
  const data = (await res.json()) as {
    id: string
    display_name: string | null
    email: string
  }
  return {
    id: data.id,
    displayName: data.display_name ?? data.id,
    email: data.email,
  }
}
