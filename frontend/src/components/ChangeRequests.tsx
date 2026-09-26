import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { fmtTimestamp } from '../dates'
import type { ChangeRequest, Member } from '../types'

// Changements sensibles (règles de garde, enfants, annulation d'échange) en
// attente de l'accord de l'autre parent.
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
  const [items, setItems] = useState<ChangeRequest[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.listChangeRequests(householdId).then(setItems).catch(() => setItems([]))
  }, [householdId])

  useEffect(load, [load, refreshKey])

  if (items.length === 0) return null
  const name = (id: number) => members.find((m) => m.id === id)?.display_name ?? "L'autre parent"

  async function act(id: number, fn: (h: number, id: number) => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn(householdId, id)
      load()
      onResolved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="change-requests">
      {items.map((r) => {
        const mine = r.requested_by === myId
        return (
          <article key={r.id} className={`change-request${mine ? '' : ' to-answer'}`}>
            <div className="change-main">
              <p className="eyebrow">
                {mine ? 'Votre demande · en attente' : `${name(r.requested_by)} demande votre accord`}
              </p>
              <p className="change-summary">{r.summary}</p>
              <p className="hint">{fmtTimestamp(r.created_at)}</p>
            </div>
            <div className="actions">
              {mine ? (
                <button className="secondary" disabled={busy === r.id} onClick={() => act(r.id, api.withdrawChange)}>
                  Retirer
                </button>
              ) : (
                <>
                  <button disabled={busy === r.id} onClick={() => act(r.id, api.acceptChange)}>
                    Accepter
                  </button>
                  <button className="secondary" disabled={busy === r.id} onClick={() => act(r.id, api.refuseChange)}>
                    Refuser
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
