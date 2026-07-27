import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { isSolo } from '../members'
import type { Member, ScheduleException } from '../types'

interface Props {
  householdId: number
  date: string
  members: Member[]
  existing: ScheduleException[]
  onClose: () => void
  onChanged: () => void
}

export default function ExceptionDialog({ householdId, date, members, existing, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const solo = isSolo(members)

  const [dateStart, setDateStart] = useState(date)
  const [dateEnd, setDateEnd] = useState(date)
  const [parentId, setParentId] = useState<number>(members[0]?.id ?? 0)
  const [note, setNote] = useState('')
  const [replacesId, setReplacesId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Propositions/échanges qui recouvrent le jour cliqué.
  const overlapping = existing.filter(
    (e) => e.date_start <= date && date <= e.date_end && (e.status === 'pending' || e.status === 'accepted'),
  )

  function parentName(id: number) {
    return members.find((m) => m.id === id)?.display_name ?? '?'
  }

  function fmtRange(e: { date_start: string; date_end: string }) {
    return e.date_start === e.date_end ? e.date_start : `${e.date_start} → ${e.date_end}`
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  function create() {
    return run(() =>
      api.createException(householdId, {
        date_start: dateStart,
        date_end: dateEnd,
        parent_id: parentId,
        note,
        ...(replacesId !== null ? { replaces_id: replacesId } : {}),
      }),
    )
  }

  // Prépare une contre-proposition : refuse l'originale puis pré-remplit le formulaire.
  async function startCounter(e: ScheduleException) {
    setBusy(true)
    setError(null)
    try {
      await api.refuseExchange(householdId, e.id)
      onChanged()
      setReplacesId(e.id)
      setDateStart(e.date_start)
      setDateEnd(e.date_end)
      setParentId(members.find((m) => m.id !== e.parent_id)?.id ?? e.parent_id)
      setNote('')
      setBusy(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <h2>{solo ? 'Échange ponctuel' : 'Proposer un échange'}</h2>

        {overlapping.map((e) => {
          const iAmProposer = user?.id === e.created_by
          return (
            <div key={e.id} className="card" style={{ padding: 12 }}>
              <p style={{ margin: '0 0 8px' }}>
                {e.status === 'pending' ? (
                  <span className="tag tag-pending">Proposé</span>
                ) : (
                  <span className="tag tag-accepted">Confirmé</span>
                )}{' '}
                {fmtRange(e)} chez <strong>{parentName(e.parent_id)}</strong>
                {e.note && <em> — {e.note}</em>}
              </p>

              {e.status === 'pending' && !iAmProposer && (
                <div className="row" style={{ gap: 8 }}>
                  <button onClick={() => run(() => api.acceptExchange(householdId, e.id))} disabled={busy}>
                    Accepter
                  </button>
                  <button className="secondary" onClick={() => run(() => api.refuseExchange(householdId, e.id))} disabled={busy}>
                    Refuser
                  </button>
                  <button className="secondary" onClick={() => startCounter(e)} disabled={busy}>
                    Contre-proposer
                  </button>
                </div>
              )}
              {e.status === 'pending' && iAmProposer && (
                <p style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="hint">En attente de l'autre parent…</span>
                  <button className="danger-link" onClick={() => run(() => api.withdrawExchange(householdId, e.id))} disabled={busy}>
                    Retirer
                  </button>
                </p>
              )}
              {e.status === 'accepted' && (
                <button className="danger-link" onClick={() => run(() => api.deleteException(householdId, e.id))} disabled={busy}>
                  Annuler l'échange
                </button>
              )}
            </div>
          )
        })}

        {replacesId !== null && (
          <div className="info-banner">Contre-proposition — l'ancienne proposition a été refusée.</div>
        )}

        <div className="row">
          <div>
            <label htmlFor="ds">Du</label>
            <input id="ds" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="de">Au (inclus)</label>
            <input id="de" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>
        </div>
        <label htmlFor="par">L'enfant sera chez</label>
        <select id="par" value={parentId} onChange={(e) => setParentId(Number(e.target.value))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
        <label htmlFor="note">Note (facultatif)</label>
        <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. anniversaire de mamie" />
        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={create} disabled={busy}>
            {solo ? 'Enregistrer' : replacesId !== null ? 'Envoyer la contre-proposition' : 'Proposer'}
          </button>
          <button className="secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
        <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
          {solo
            ? "L'échange est appliqué directement."
            : "L'autre parent recevra la proposition et pourra l'accepter ou la refuser."}
        </p>
      </div>
    </div>
  )
}
