// Pure Spotify helpers (no auth, no network).

const URI_RE = /^spotify:track:([A-Za-z0-9]{22})$/
const URL_RE = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/i

// Accepts either a spotify:track:... URI or an open.spotify.com/track/...
// URL (with or without the localized /intl-xx/ segment and query string).
// Returns the canonical URI form, or null if the input isn't a track link.
export function normalizeSpotifyUri(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const uri = trimmed.match(URI_RE)
  if (uri) return trimmed
  const url = trimmed.match(URL_RE)
  if (url) return `spotify:track:${url[1]}`
  return null
}

export function trackIdFromUri(uri: string): string | null {
  const m = uri.match(URI_RE)
  return m ? m[1] : null
}
