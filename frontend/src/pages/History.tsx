import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import TopBar from '../components/TopBar'
import { fmtDayLong, fmtTimestamp } from '../dates'
import type { HistoryEntry, Household } from '../types'

// Journal immuable des modifications du foyer : qui a changé quoi, et quand.
export default function HistoryPage() {
  const navigate = useNavigate()
  const [household, setHousehold] = useState<Household | null>(null)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .myHousehold()
      .then(setHousehold)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) navigate('/onboarding')
        else setError(err instanceof Error ? err.message : 'Erreur')
      })
  }, [navigate])

  const loadMore = useCallback(
    (beforeId?: number) => {
      if (!household) return
      api
        .history(household.id, beforeId)
        .then((page) => {
          setEntries((prev) => (beforeId ? [...prev, ...page] : page))
          if (page.length < 50) setDone(true)
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))
    },
    [household],
  )

  useEffect(() => loadMore(), [loadMore])

  if (!household) return <div className="page-loading">Chargement…</div>
  const member = (id: number | null) => household.members.find((m) => m.id === id)

  // Regroupement par jour.
  const days = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const d = new Date(e.created_at.endsWith('Z') ? e.created_at : e.created_at + 'Z')
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.set(key, [...(days.get(key) ?? []), e])
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout narrow">
        <h1>Historique du foyer</h1>
        <p className="hint" style={{ marginTop: 0 }}>
          Toutes les modifications, horodatées et non modifiables. Visible par les deux parents.
        </p>
        {error && <div className="error">{error}</div>}
        {entries.length === 0 && !error && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">🕒</span>
            <h2>Rien pour l'instant</h2>
            <p>Les changements de règles, échanges, dépenses et messages apparaîtront ici.</p>
          </div>
        )}
        {[...days.entries()].map(([day, items]) => (
          <section key={day} className="list-group">
            <h2 className="section-label">{fmtDayLong(day)}</h2>
            <div className="list-card">
              {items.map((e) => {
                const m = member(e.actor_id)
                return (
                  <article key={e.id} className="list-row history-row">
                    <span className="avatar small" style={{ background: m?.color ?? 'var(--line)' }} aria-hidden="true">
                      {m?.display_name.charAt(0).toUpperCase() ?? '·'}
                    </span>
                    <div className="list-main">
                      <div>
                        <strong>{m?.display_name ?? 'Système'}</strong> {e.summary}
                      </div>
                      <div className="hint">{fmtTimestamp(e.created_at)}</div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
        {!done && entries.length > 0 && (
          <p style={{ textAlign: 'center' }}>
            <button className="secondary" onClick={() => loadMore(entries[entries.length - 1].id)}>
              Voir plus
            </button>
          </p>
        )}
      </div>
    </>
  )
}
