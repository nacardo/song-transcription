import { useEffect, useState } from 'react'
import { computeMetrics, listAllProgress, type Metrics } from './metrics'
import { listSongs } from './storage'

type Props = {
  onBack: () => void
}

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; metrics: Metrics }
  | { state: 'error'; message: string }

export function MetricsView({ onBack }: Props) {
  const [load, setLoad] = useState<LoadState>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [songs, progresses] = await Promise.all([
          listSongs(),
          listAllProgress(),
        ])
        if (cancelled) return
        setLoad({ state: 'ready', metrics: computeMetrics(songs, progresses) })
      } catch (err: unknown) {
        if (!cancelled) setLoad({ state: 'error', message: String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <header className="song-header">
        <button type="button" className="link" onClick={onBack}>
          ← Library
        </button>
        <div className="song-header-title">
          <div className="song-header-text">
            <h1>Metrics</h1>
          </div>
        </div>
        <span aria-hidden="true" />
      </header>

      {load.state === 'loading' && <p className="muted">Loading…</p>}

      {load.state === 'error' && (
        <div className="banner error" role="alert">
          <span>Couldn't load metrics: {load.message}</span>
        </div>
      )}

      {load.state === 'ready' && <MetricsBody metrics={load.metrics} />}
    </main>
  )
}

function MetricsBody({ metrics }: { metrics: Metrics }) {
  return (
    <>
      <div className="stat-grid">
        <StatCard
          value={metrics.totalWordsTranscribed}
          label="Total words transcribed"
        />
        <StatCard
          value={metrics.uniqueWordsTranscribed}
          label="Unique words transcribed"
        />
      </div>

      <section className="metric-section">
        <h2 className="metric-section-title">Most-revealed words</h2>
        {metrics.mostRevealedWords.length === 0 ? (
          <p className="muted">
            None yet — words you hit <em>?</em> on will show up here.
          </p>
        ) : (
          <ol className="reveal-count-list">
            {metrics.mostRevealedWords.map((row) => (
              <li key={row.word} className="reveal-count-row">
                <span className="reveal-count-word">{row.word}</span>
                <span className="reveal-count-count">{row.count}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="metric-section">
        <h2 className="metric-section-title">Per-song completion</h2>
        {metrics.perSongCompletion.length === 0 ? (
          <p className="muted">Add a song to start tracking completion.</p>
        ) : (
          <ul className="completion-list">
            {metrics.perSongCompletion.map((row) => {
              // Revealed segment sits after the correct segment on the bar.
              // Both are clamped so a very-small song with lots of reveals
              // doesn't overflow the container mathematically.
              const correctPct =
                row.totalWords === 0
                  ? 0
                  : (row.correctWords / row.totalWords) * 100
              const revealedPct =
                row.totalWords === 0
                  ? 0
                  : Math.min(
                      100 - correctPct,
                      (row.revealedWords / row.totalWords) * 100,
                    )
              return (
                <li key={row.songId} className="completion-row">
                  <div className="completion-header">
                    <span className="completion-title">
                      {row.title}
                      {row.artist && (
                        <span className="completion-artist">
                          {' · '}
                          {row.artist}
                        </span>
                      )}
                    </span>
                    <span className="completion-pct">
                      {row.completionPct.toFixed(0)}%
                    </span>
                  </div>
                  <div
                    className="completion-bar"
                    role="progressbar"
                    aria-valuenow={Math.round(row.completionPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="completion-fill correct"
                      style={{ width: `${correctPct}%` }}
                    />
                    <div
                      className="completion-fill revealed"
                      style={{ width: `${revealedPct}%` }}
                    />
                  </div>
                  <div className="completion-meta">
                    {row.correctWords} correct · {row.revealedWords} revealed
                    · {row.totalWords} total
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat-card">
      <div className="stat-number">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
