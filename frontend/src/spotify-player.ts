// Spotify playback wrapper. Two modes with the same public API:
//   - "sdk"     : desktop; audio plays in the browser tab via the Web Playback
//                 SDK.  Fast local seek/toggle.
//   - "connect" : mobile / any browser where the SDK can't create a device.
//                 We control an external Spotify Connect device (the user's
//                 phone Spotify app, another Connect speaker, etc.) via the
//                 Web API. Slightly higher latency; UI is identical.

import { getValidAccessToken } from './spotify-auth'

// --- Minimal Web Playback SDK types (avoids an extra @types dep) ---
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

export type PlayerMode = 'sdk' | 'connect'

export type PlayerState = {
  isPlaying: boolean
  position: number
  duration: number
  trackUri: string | null
}

export type Device = {
  id: string
  name: string
  type: string
  isActive: boolean
}

export type DeviceInfo = {
  mode: PlayerMode | null
  deviceId: string | null
  deviceName: string | null
}

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js'
const API = 'https://api.spotify.com/v1'

let sdkLoad: Promise<void> | null = null
let initPromise: Promise<void> | null = null
let sdkPlayer: SdkPlayer | null = null

let mode: PlayerMode | null = null
let deviceId: string | null = null
let deviceName: string | null = null

let base:
  | {
      position: number
      timestamp: number
      isPlaying: boolean
      duration: number
      trackUri: string | null
    }
  | null = null

const stateListeners = new Set<(state: PlayerState | null) => void>()
const deviceListeners = new Set<(info: DeviceInfo) => void>()
let tickHandle: number | null = null
let connectPollHandle: number | null = null

// ---------- helpers ----------

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

function notifyState() {
  const state = computeState()
  for (const l of stateListeners) l(state)
}

function notifyDevice() {
  const info: DeviceInfo = { mode, deviceId, deviceName }
  for (const l of deviceListeners) l(info)
}

function updateBaseFromSdk(sdk: SdkState | null) {
  base = sdk
    ? {
        position: sdk.position,
        timestamp: Date.now(),
        isPlaying: !sdk.paused,
        duration: sdk.duration,
        trackUri: sdk.track_window?.current_track?.uri ?? null,
      }
    : null
  notifyState()
}

function startTicking() {
  if (tickHandle !== null) return
  tickHandle = window.setInterval(notifyState, 250)
}

// ---------- SDK mode ----------

function loadSdkScript(): Promise<void> {
  if (sdkLoad) return sdkLoad
  sdkLoad = new Promise<void>((resolve, reject) => {
    if (window.Spotify) return resolve()
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.onerror = () => reject(new Error('Failed to load Spotify SDK'))
    document.head.appendChild(script)
  })
  return sdkLoad
}

async function connectSdk(): Promise<{ id: string; name: string }> {
  await loadSdkScript()
  if (!window.Spotify) throw new Error('Spotify SDK unavailable')
  const name = 'Song Transcription'
  return new Promise<{ id: string; name: string }>((resolve, reject) => {
    const p = new window.Spotify!.Player({
      name,
      getOAuthToken: (cb) => {
        getValidAccessToken()
          .then(cb)
          .catch(() => cb(''))
      },
      volume: 0.7,
    })
    p.addListener('ready', ({ device_id }) => {
      sdkPlayer = p
      resolve({ id: device_id, name })
    })
    p.addListener('initialization_error', ({ message }) =>
      reject(new Error(`Init error: ${message}`)),
    )
    p.addListener('authentication_error', ({ message }) =>
      reject(new Error(`Auth error: ${message}`)),
    )
    p.addListener('account_error', ({ message }) =>
      reject(new Error(`Account error: ${message} (Premium required)`)),
    )
    p.addListener('player_state_changed', (state) => updateBaseFromSdk(state))
    p.connect()
  })
}

// ---------- Connect mode ----------

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getValidAccessToken()
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
}

export async function listDevices(): Promise<Device[]> {
  const res = await apiFetch('/me/player/devices')
  if (!res.ok) throw new Error(`Devices failed: ${res.status}`)
  const data = (await res.json()) as {
    devices: Array<{
      id: string
      name: string
      type: string
      is_active: boolean
    }>
  }
  return data.devices.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    isActive: d.is_active,
  }))
}

async function pickConnectDevice(): Promise<{ id: string; name: string }> {
  const devices = await listDevices()
  if (devices.length === 0) {
    throw new Error(
      'No Spotify device available. Open Spotify on your phone (tap play on anything) or on another device, then retry.',
    )
  }
  const active = devices.find((d) => d.isActive)
  if (active) return { id: active.id, name: active.name }
  const nonComputer = devices.find((d) => d.type !== 'Computer')
  if (nonComputer) return { id: nonComputer.id, name: nonComputer.name }
  return { id: devices[0].id, name: devices[0].name }
}

async function fetchConnectState(): Promise<void> {
  const res = await apiFetch('/me/player')
  if (res.status === 204) return // nothing playing
  if (!res.ok) return
  const data = (await res.json()) as {
    is_playing: boolean
    progress_ms: number
    item: { uri: string; duration_ms: number } | null
  }
  if (!data.item) return
  base = {
    position: data.progress_ms,
    timestamp: Date.now(),
    isPlaying: data.is_playing,
    duration: data.item.duration_ms,
    trackUri: data.item.uri,
  }
  notifyState()
}

function startConnectPolling() {
  if (connectPollHandle !== null) return
  connectPollHandle = window.setInterval(() => {
    fetchConnectState().catch(() => {})
  }, 2000)
}

function stopConnectPolling() {
  if (connectPollHandle === null) return
  window.clearInterval(connectPollHandle)
  connectPollHandle = null
}

// ---------- Public API ----------

function isMobileUA(): boolean {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export async function initializePlayer(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    // Try the SDK on non-mobile first; fall back to Connect on any failure.
    if (!isMobileUA()) {
      try {
        const d = await connectSdk()
        mode = 'sdk'
        deviceId = d.id
        deviceName = d.name
        startTicking()
        notifyDevice()
        return
      } catch {
        // fall through
      }
    }
    const d = await pickConnectDevice()
    mode = 'connect'
    deviceId = d.id
    deviceName = d.name
    await fetchConnectState().catch(() => {})
    startTicking()
    startConnectPolling()
    notifyDevice()
  })()
  initPromise.catch(() => {
    // Allow another attempt via reinitializePlayer().
    initPromise = null
  })
  return initPromise
}

// Force re-detection (used by "Retry" when devices weren't available yet).
export async function reinitializePlayer(): Promise<void> {
  stopConnectPolling()
  initPromise = null
  mode = null
  deviceId = null
  deviceName = null
  notifyDevice()
  return initializePlayer()
}

export async function setDevice(id: string): Promise<void> {
  const devices = await listDevices()
  const target = devices.find((d) => d.id === id)
  if (!target) throw new Error('Device not available anymore')
  // Transfer playback so subsequent play/pause/seek target this device.
  await apiFetch('/me/player', {
    method: 'PUT',
    body: JSON.stringify({
      device_ids: [id],
      play: base?.isPlaying ?? false,
    }),
  })
  deviceId = id
  deviceName = target.name
  // In Connect mode we keep polling; in SDK mode, switching to another device
  // means the SDK browser device is no longer where audio comes out, so we
  // move to Connect mode for control.
  if (mode === 'sdk' && !devices.find((d) => d.id === id && d.name === 'Song Transcription')) {
    mode = 'connect'
    startConnectPolling()
  }
  notifyDevice()
  await fetchConnectState().catch(() => {})
}

export async function playTrack(
  uri: string,
  positionMs?: number,
): Promise<void> {
  if (!deviceId) await initializePlayer()
  const body: Record<string, unknown> = { uris: [uri] }
  if (positionMs && positionMs > 0) body.position_ms = Math.round(positionMs)
  const res = await apiFetch(`/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`Play failed: ${res.status} ${await res.text()}`)
  }
  // Optimistic: assume it started.
  const startPos = positionMs && positionMs > 0 ? Math.round(positionMs) : 0
  base = base
    ? { ...base, isPlaying: true, timestamp: Date.now(), trackUri: uri, position: startPos }
    : {
        position: startPos,
        timestamp: Date.now(),
        isPlaying: true,
        duration: 0,
        trackUri: uri,
      }
  notifyState()
  if (mode === 'connect') {
    setTimeout(() => fetchConnectState().catch(() => {}), 400)
  }
}

export async function togglePlay(): Promise<void> {
  if (mode === 'sdk' && sdkPlayer) {
    await sdkPlayer.togglePlay()
    return
  }
  const isPlaying = base?.isPlaying ?? false
  const endpoint = isPlaying ? 'pause' : 'play'
  const res = await apiFetch(
    `/me/player/${endpoint}?device_id=${deviceId}`,
    { method: 'PUT' },
  )
  if (!res.ok && res.status !== 204) {
    throw new Error(`${endpoint} failed: ${res.status}`)
  }
  if (base) {
    base = { ...base, isPlaying: !isPlaying, timestamp: Date.now() }
    notifyState()
  }
  if (mode === 'connect') {
    setTimeout(() => fetchConnectState().catch(() => {}), 400)
  }
}

export async function seekTo(positionMs: number): Promise<void> {
  const clamped = Math.max(0, Math.round(positionMs))
  if (mode === 'sdk' && sdkPlayer) {
    await sdkPlayer.seek(clamped)
  } else {
    const res = await apiFetch(
      `/me/player/seek?position_ms=${clamped}&device_id=${deviceId}`,
      { method: 'PUT' },
    )
    if (!res.ok && res.status !== 204) {
      throw new Error(`Seek failed: ${res.status}`)
    }
  }
  if (base) {
    base = { ...base, position: clamped, timestamp: Date.now() }
    notifyState()
  }
}

// Jump to `positionMs` in `uri` and make sure playback is running.
// Behavior:
//   - our track already playing → just seek
//   - our track paused          → seek then resume
//   - a different track (or nothing) → start this one at positionMs
// Used by the ▶ button next to each lyric line so clicking one always ends
// with the song playing from that point.
export async function playFromLine(
  uri: string,
  positionMs: number,
): Promise<void> {
  const current = base
  const isSameTrack = current?.trackUri === uri
  if (!isSameTrack) {
    await playTrack(uri, positionMs)
    return
  }
  await seekTo(positionMs)
  if (!current?.isPlaying) {
    await togglePlay()
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

export function subscribeToState(
  cb: (state: PlayerState | null) => void,
): () => void {
  stateListeners.add(cb)
  cb(computeState())
  return () => {
    stateListeners.delete(cb)
  }
}

export function subscribeToDevice(cb: (info: DeviceInfo) => void): () => void {
  deviceListeners.add(cb)
  cb({ mode, deviceId, deviceName })
  return () => {
    deviceListeners.delete(cb)
  }
}
