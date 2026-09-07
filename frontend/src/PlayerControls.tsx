import { useEffect, useState } from 'react'
import { isAuthenticated } from './spotify-auth'
import {
  initializePlayer,
  listDevices,
  playTrack,
  reinitializePlayer,
  seekBy,
  seekTo,
  setDevice,
  subscribeToDevice,
  subscribeToState,
  togglePlay,
  type Device,
  type DeviceInfo,
  type PlayerState,
} from './spotify-player'

type Props = {
  spotifyUri: string
}

function formatTime(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function PlayerControls({ spotifyUri }: Props) {
  const [state, setState] = useState<PlayerState | null>(null)
  const [device, setDeviceInfo] = useState<DeviceInfo>({
    mode: null,
    deviceId: null,
    deviceName: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) return
    let cancelled = false
    initializePlayer()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err))
      })
    const unsubS = subscribeToState(setState)
    const unsubD = subscribeToDevice(setDeviceInfo)
    return () => {
      cancelled = true
      unsubS()
      unsubD()
    }
  }, [])

  if (!isAuthenticated()) {
    return (
      <div className="player-bar muted">
        Connect Spotify to play this track.
      </div>
    )
  }

  async function guard(fn: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function refreshDevicePicker() {
    setError(null)
    try {
      const list = await listDevices()
      setDevices(list)
      setShowPicker(true)
    } catch (e) {
      setError(String(e))
    }
  }

  async function pickDevice(id: string) {
    setShowPicker(false)
    await guard(() => setDevice(id))
  }

  async function retryInit() {
    setError(null)
    setReady(false)
    try {
      await reinitializePlayer()
      setReady(true)
    } catch (e) {
      setError(String(e))
    }
  }

  if (!ready && !error) {
    return <div className="player-bar muted">Connecting to Spotify…</div>
  }

  const isCurrent = state?.trackUri === spotifyUri
  const isPlaying = !!(isCurrent && state?.isPlaying)
  const position = isCurrent ? state?.position ?? 0 : 0
  const duration = isCurrent ? state?.duration ?? 0 : 0

  async function handlePlayPause() {
    if (!isCurrent) {
      await guard(() => playTrack(spotifyUri))
    } else {
      await guard(() => togglePlay())
    }
  }

  return (
    <div className="player-bar">
      <div className="player-buttons">
        <button
          type="button"
          onClick={() => guard(() => seekBy(-10))}
          disabled={!isCurrent}
          title="Back 10s"
        >
          « 10
        </button>
        <button
          type="button"
          onClick={() => guard(() => seekBy(-5))}
          disabled={!isCurrent}
          title="Back 5s"
        >
          « 5
        </button>
        <button
          type="button"
          className="play"
          onClick={handlePlayPause}
          disabled={busy && !isCurrent}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          onClick={() => guard(() => seekBy(5))}
          disabled={!isCurrent}
          title="Forward 5s"
        >
          5 »
        </button>
        <button
          type="button"
          onClick={() => guard(() => seekBy(10))}
          disabled={!isCurrent}
          title="Forward 10s"
        >
          10 »
        </button>
      </div>

      <div className="player-time" aria-live="off">
        {formatTime(position)} / {formatTime(duration)}
      </div>

      <input
        className="player-scrub"
        type="range"
        min={0}
        max={duration || 1}
        value={position}
        step={1000}
        onChange={(e) => guard(() => seekTo(Number(e.target.value)))}
        disabled={!isCurrent || duration === 0}
        aria-label="Playback position"
      />

      <div className="player-device">
        <span className="player-device-name" title={device.deviceName ?? ''}>
          {device.mode === 'sdk' ? 'This tab' : device.deviceName ?? '—'}
        </span>
        <button
          type="button"
          className="link small"
          onClick={refreshDevicePicker}
        >
          Change
        </button>
      </div>

      {showPicker && (
        <div className="device-picker">
          <div className="device-picker-header">
            <span>Pick device</span>
            <button
              type="button"
              className="link small"
              onClick={() => setShowPicker(false)}
            >
              Close
            </button>
          </div>
          {devices && devices.length === 0 && (
            <div className="muted">No devices available.</div>
          )}
          <ul>
            {devices?.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="link"
                  onClick={() => pickDevice(d.id)}
                >
                  {d.name}{' '}
                  <span className="muted">
                    ({d.type}
                    {d.isActive ? ', active' : ''})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="player-error">
          {error}
          <button type="button" className="link small" onClick={retryInit}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
