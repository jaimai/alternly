import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useFormat } from '../format'
import type { ChangeRequest, Member } from '../types'

// Changements sensibles (règles de garde, enfants, annulation d'échange) en
// attente de l'accord de l'autre parent. Ne rend rien s'il n'y en a pas (ou si
// le backend ne connaît pas encore les demandes de changement).
export default function ChangeRequests({
  householdId,
  myId,
  members,
  refreshKey = 0,
  onResolved,
}: {
  householdId: number
  myId: number
  members: Member[]
  refreshKey?: number
  onResolved?: () => void
}) {
  const { t } = useTranslation()
  const { timestamp } = useFormat()
  const [items, setItems] = useState<ChangeRequest[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.listChangeRequests(householdId).then(setItems).catch(() => setItems([]))
  }, [householdId])

  useEffect(load, [load, refreshKey])

  if (items.length === 0) return null
  const name = (id: number) => members.find((m) => m.id === id)?.display_name ?? t('changes.otherParent')

  async function act(id: number, fn: (h: number, id: number) => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn(householdId, id)
      load()
      onResolved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('changes.error'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="change-requests ph-mask ph-sensitive" aria-label={t('changes.title')}>
      {items.map((r) => {
        const mine = r.requested_by === myId
        return (
          <article key={r.id} className={`change-request${mine ? '' : ' to-answer'}`}>
            <div className="change-main">
              <p className="eyebrow">{mine ? t('changes.mine') : t('changes.theirs', { name: name(r.requested_by) })}</p>
              <p className="change-summary">{r.summary}</p>
              <p className="hint">{timestamp(r.created_at)}</p>
            </div>
            <div className="actions">
              {mine ? (
                <button className="secondary" disabled={busy === r.id} onClick={() => act(r.id, api.withdrawChange)}>
                  {t('changes.withdraw')}
                </button>
              ) : (
                <>
                  <button disabled={busy === r.id} onClick={() => act(r.id, api.acceptChange)}>
                    {t('changes.accept')}
                  </button>
                  <button className="secondary" disabled={busy === r.id} onClick={() => act(r.id, api.refuseChange)}>
                    {t('changes.refuse')}
                  </button>
                </>
              )}
            </div>
          </article>
        )
      })}
      {error && <div className="error">{error}</div>}
    </section>
  )
}
