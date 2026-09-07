// Shared fetch wrapper. Sends cookies, defaults JSON content-type when there's
// a body, and fires an app:unauthorized event on 401 so App can show login.

const UNAUTHORIZED_EVENT = 'app:unauthorized'

export async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  }
  return res
}

export async function apiJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(url, init)
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status}`)
  }
  return (await res.json()) as Promise<T>
}

export function onUnauthorized(handler: () => void): () => void {
  window.addEventListener(UNAUTHORIZED_EVENT, handler)
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
}

// --- Session endpoints (public — the auth router itself isn't guarded) ---

export async function checkSession(): Promise<boolean> {
  const res = await fetch('/api/session', { credentials: 'include' })
  if (!res.ok) return false
  const body = (await res.json()) as { authed: boolean }
  return body.authed
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-password' | 'not-configured' | 'error'; detail?: string }

export async function login(password: string): Promise<LoginResult> {
  const res = await fetch('/api/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (res.ok) return { ok: true }
  if (res.status === 401) return { ok: false, reason: 'wrong-password' }
  if (res.status === 503) return { ok: false, reason: 'not-configured' }
  return { ok: false, reason: 'error', detail: `HTTP ${res.status}` }
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' })
}
