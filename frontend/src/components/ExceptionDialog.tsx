import { useState } from 'react'
import { api } from '../api'
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
  const [dateStart, setDateStart] = useState(date)
  const [dateEnd, setDateEnd] = useState(date)
  const [parentId, setParentId] = useState<number>(members[0]?.id ?? 0)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const overlapping = existing.filter((e) => e.date_start <= date && date <= e.date_end)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      await api.createException(householdId, { date_start: dateStart, date_end: dateEnd, parent_id: parentId, note })
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    setBusy(true)
    try {
      await api.deleteException(householdId, id)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  function parentName(id: number) {
    return members.find((m) => m.id === id)?.display_name ?? '?'
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Échange ponctuel</h2>
        {overlapping.length > 0 && (
          <div className="card" style={{ padding: 12 }}>
            {overlapping.map((e) => (
              <p key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0' }}>
                <span>
                  {e.date_start === e.date_end ? e.date_start : `${e.date_start} → ${e.date_end}`} chez{' '}
                  <strong>{parentName(e.parent_id)}</strong>
                  {e.note && <em> — {e.note}</em>}
                </span>
                <button className="danger-link" onClick={() => remove(e.id)} disabled={busy}>
                  Annuler l'échange
                </button>
              </p>
            ))}
          </div>
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
            Enregistrer
          </button>
          <button className="secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
        <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--text-soft)' }}>
          L'autre parent sera notifié de ce changement.
        </p>
      </div>
    </div>
  )
}
