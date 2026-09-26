import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../components/Icon'
import Spinner from '../components/Spinner'
import TopBar from '../components/TopBar'
import { isoLocal, parseTimestamp } from '../dates'
import { useFormat } from '../format'
import type { HistoryEntry } from '../types'

const PAGE = 50

// Journal immuable des modifications du foyer : qui a changé quoi, et quand.
export default function HistoryPage() {
  const { t } = useTranslation()
  const { dayLong, timestamp } = useFormat()
  const navigate = useNavigate()
  const { household, householdLoaded } = useAuth()
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (householdLoaded && !household) navigate('/onboarding')
  }, [householdLoaded, household, navigate])

  const loadMore = useCallback(
    (beforeId?: number) => {
      if (!household) return
      api
        .history(household.id, beforeId)
        .then((page) => {
          setEntries((prev) => (beforeId ? [...prev, ...page] : page))
          if (page.length < PAGE) setDone(true)
        })
        .catch((err) => setError(err instanceof Error ? err.message : t('history.error')))
        .finally(() => setLoaded(true))
    },
    [household, t],
  )

  useEffect(() => loadMore(), [loadMore])

  if (!household) return <Spinner />
  const member = (id: number | null) => household.members.find((m) => m.id === id)

  // Regroupement par jour (heure locale).
  const days = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const key = isoLocal(parseTimestamp(e.created_at))
    days.set(key, [...(days.get(key) ?? []), e])
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout narrow">
        <h1>{t('history.title')}</h1>
        <p className="hint" style={{ marginTop: 0 }}>{t('history.subtitle')}</p>
        {error && <div className="error">{error}</div>}
        {!loaded && <Spinner inline />}
        {loaded && entries.length === 0 && !error && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <Icon name="history" size={24} />
            </span>
            <h2>{t('history.emptyTitle')}</h2>
            <p>{t('history.emptyBody')}</p>
          </div>
        )}
        {[...days.entries()].map(([day, items]) => (
          <section key={day} className="list-group">
            <h2 className="section-label">{dayLong(day)}</h2>
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
                        <strong>{m?.display_name ?? t('history.system')}</strong> {e.summary}
                      </div>
                      <div className="hint">{timestamp(e.created_at)}</div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
        {!done && entries.length > 0 && (
          <p style={{ textAlign: 'center', marginTop: 16 }}>
            <button className="secondary" onClick={() => loadMore(entries[entries.length - 1].id)}>
              {t('history.more')}
            </button>
          </p>
        )}
      </div>
    </>
  )
}
