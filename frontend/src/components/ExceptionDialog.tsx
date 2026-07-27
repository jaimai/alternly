import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useAuth } from '../auth'
import { isSolo } from '../members'
import { useFormat } from '../format'
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
  const { t } = useTranslation()
  const { date: fmtDate } = useFormat()
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
    return e.date_start === e.date_end
      ? fmtDate(e.date_start)
      : `${fmtDate(e.date_start)} → ${fmtDate(e.date_end)}`
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('exchange.errorGeneric'))
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
      setError(err instanceof Error ? err.message : t('exchange.errorGeneric'))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <h2>{solo ? t('exchange.titleSolo') : t('exchange.titlePropose')}</h2>

        {overlapping.map((e) => {
          const iAmProposer = user?.id === e.created_by
          return (
            <div key={e.id} className="card" style={{ padding: 12 }}>
              <p style={{ margin: '0 0 8px' }}>
                {e.status === 'pending' ? (
                  <span className="tag tag-pending">{t('exchange.tagProposed')}</span>
                ) : (
                  <span className="tag tag-accepted">{t('exchange.tagConfirmed')}</span>
                )}{' '}
                {fmtRange(e)} {t('exchange.at')} <strong>{parentName(e.parent_id)}</strong>
                {e.note && <em> — {e.note}</em>}
              </p>

              {e.status === 'pending' && !iAmProposer && (
                <div className="row" style={{ gap: 8 }}>
                  <button onClick={() => run(() => api.acceptExchange(householdId, e.id))} disabled={busy}>
                    {t('exchange.accept')}
                  </button>
                  <button className="secondary" onClick={() => run(() => api.refuseExchange(householdId, e.id))} disabled={busy}>
                    {t('exchange.decline')}
                  </button>
                  <button className="secondary" onClick={() => startCounter(e)} disabled={busy}>
                    {t('exchange.counterPropose')}
                  </button>
                </div>
              )}
              {e.status === 'pending' && iAmProposer && (
                <p style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="hint">{t('exchange.waitingOtherParent')}</span>
                  <button className="danger-link" onClick={() => run(() => api.withdrawExchange(householdId, e.id))} disabled={busy}>
                    {t('exchange.withdraw')}
                  </button>
                </p>
              )}
              {e.status === 'accepted' && (
                <button className="danger-link" onClick={() => run(() => api.deleteException(householdId, e.id))} disabled={busy}>
                  {t('exchange.cancelExchange')}
                </button>
              )}
            </div>
          )
        })}

        {replacesId !== null && (
          <div className="info-banner">{t('exchange.counterBanner')}</div>
        )}

        <div className="row">
          <div>
            <label htmlFor="ds">{t('exchange.fromLabel')}</label>
            <input id="ds" type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="de">{t('exchange.toLabel')}</label>
            <input id="de" type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>
        </div>
        <label htmlFor="par">{t('exchange.childWillBeWith')}</label>
        <select id="par" value={parentId} onChange={(e) => setParentId(Number(e.target.value))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
        <label htmlFor="note">{t('exchange.noteLabel')}</label>
        <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('exchange.notePlaceholder')} />
        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={create} disabled={busy}>
            {solo ? t('exchange.save') : replacesId !== null ? t('exchange.sendCounter') : t('exchange.propose')}
          </button>
          <button className="secondary" onClick={onClose}>
            {t('exchange.close')}
          </button>
        </div>
        <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
          {solo ? t('exchange.footerSolo') : t('exchange.footerPropose')}
        </p>
      </div>
    </div>
  )
}
