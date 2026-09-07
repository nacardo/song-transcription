import { useState } from 'react'
import { login } from './api'

type Props = {
  onSuccess: () => void
}

export function Login({ onSuccess }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setError(null)
    setBusy(true)
    try {
      const result = await login(password)
      if (result.ok) {
        setPassword('')
        onSuccess()
        return
      }
      setError(
        result.reason === 'wrong-password'
          ? 'Wrong password.'
          : result.reason === 'not-configured'
            ? 'Password not configured on the server. Set APP_PASSWORD in the backend env.'
            : `Login failed${result.detail ? `: ${result.detail}` : ''}.`,
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <h1>Song Transcription</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          className="title"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || !password}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
      </form>
    </main>
  )
}
