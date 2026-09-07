// Spotify Web Playback SDK wrapper. Creates a "browser tab" playback device,
// handles play/pause/seek locally, and interpolates position between events
// for a smooth UI without polling the API.

import { getValidAccessToken } from './spotify-auth'

// Minimal SDK type declarations — we don't pull in @types/spotify-web-playback-sdk.
type SdkTrack = { uri: string; name: string }
type SdkState = {
  paused: boolean
  position: number
  duration: number
  track_window: { current_track: SdkTrack | null }
}
type SdkPlayer = {
  connect(): Promise<boolean>
  disconnect(): void
  togglePlay(): Promise<void>
  seek(positionMs: number): Promise<void>
  getCurrentState(): Promise<SdkState | null>
  addListener(
    event: 'ready' | 'not_ready',
    cb: (payload: { device_id: string }) => void,
  ): void
  addListener(
    event:
      | 'initialization_error'
      | 'authentication_error'
      | 'account_error'
      | 'playback_error',
    cb: (payload: { message: string }) => void,
  ): void
  addListener(
    event: 'player_state_changed',
    cb: (state: SdkState | null) => void,
  ): void
}
type SdkConstructor = new (options: {
  name: string
  getOAuthToken: (cb: (token: string) => void) => void
  volume?: number
}) => SdkPlayer

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: { Player: SdkConstructor }
  }
}

export type PlayerState = {
  isPlaying: boolean
  position: number
  duration: number
  trackUri: string | null
}

let sdkLoad: Promise<void> | null = null
let initPromise: Promise<string> | null = null
let player: SdkPlayer | null = null
let deviceId: string | null = null

// Base snapshot from the SDK; we extrapolate current position from this.
let base:
  | {
      position: number
      timestamp: number
      isPlaying: boolean
      duration: number
      trackUri: string | null
    }
  | null = null

const listeners = new Set<(state: PlayerState | null) => void>()
let tickHandle: number | null = null

function loadSdk(): Promise<void> {
  if (sdkLoad) return sdkLoad
  sdkLoad = new Promise<void>((resolve, reject) => {
    if (window.Spotify) {
      resolve()
      return
    }
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.onerror = () => reject(new Error('Failed to load Spotify SDK'))
    document.head.appendChild(script)
  })
  return sdkLoad
}

function computeState(): PlayerState | null {
  if (!base) return null
  const elapsed = base.isPlaying ? Date.now() - base.timestamp : 0
  const position = Math.max(
    0,
    Math.min(base.duration || Infinity, base.position + elapsed),
  )
  return {
    isPlaying: base.isPlaying,
    position,
    duration: base.duration,
    trackUri: base.trackUri,
  }
}

function notify() {
  const state = computeState()
  for (const l of listeners) l(state)
}

function updateBase(sdk: SdkState | null) {
  if (!sdk) {
    base = null
  } else {
    base = {
      position: sdk.position,
      timestamp: Date.now(),
      isPlaying: !sdk.paused,
      duration: sdk.duration,
      trackUri: sdk.track_window?.current_track?.uri ?? null,
    }
  }
  notify()
}

function startTicking() {
  if (tickHandle !== null) return
  tickHandle = window.setInterval(notify, 250)
}

export async function initializePlayer(): Promise<string> {
  if (deviceId) return deviceId
  if (initPromise) return initPromise
  initPromise = (async () => {
    await loadSdk()
    if (!window.Spotify) throw new Error('Spotify SDK failed to initialize')
    return new Promise<string>((resolve, reject) => {
      const p = new window.Spotify!.Player({
        name: 'Song Transcription',
        getOAuthToken: (cb) => {
          getValidAccessToken()
            .then(cb)
            .catch(() => cb(''))
        },
        volume: 0.7,
      })
      p.addListener('ready', ({ device_id }) => {
        deviceId = device_id
        player = p
        startTicking()
        resolve(device_id)
      })
      p.addListener('initialization_error', ({ message }) =>
        reject(new Error(`Init error: ${message}`)),
      )
      p.addListener('authentication_error', ({ message }) =>
        reject(new Error(`Auth error: ${message}`)),
      )
      p.addListener('account_error', ({ message }) =>
        reject(new Error(`Account error: ${message} (Spotify Premium required)`)),
      )
      p.addListener('player_state_changed', (state) => updateBase(state))
      p.connect()
    })
  })()
  return initPromise
}

export function subscribeToState(
  cb: (state: PlayerState | null) => void,
): () => void {
  listeners.add(cb)
  cb(computeState())
  return () => {
    listeners.delete(cb)
  }
}

export async function playTrack(uri: string): Promise<void> {
  const id = await initializePlayer()
  const token = await getValidAccessToken()
  const res = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${id}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [uri] }),
    },
  )
  if (!res.ok && res.status !== 204) {
    throw new Error(`Play failed: ${res.status} ${await res.text()}`)
  }
}

export async function togglePlay(): Promise<void> {
  if (!player) throw new Error('Player not ready')
  await player.togglePlay()
}

export async function seekTo(positionMs: number): Promise<void> {
  if (!player) throw new Error('Player not ready')
  const clamped = Math.max(0, Math.round(positionMs))
  await player.seek(clamped)
  // Update base immediately so the UI doesn't wait for the state event.
  if (base) {
    base = { ...base, position: clamped, timestamp: Date.now() }
    notify()
  }
}

export async function seekBy(seconds: number): Promise<void> {
  const state = computeState()
  if (!state) return
  const target = Math.max(
    0,
    Math.min(state.duration || Infinity, state.position + seconds * 1000),
  )
  await seekTo(target)
}
