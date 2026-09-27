import { useEffect, useRef, useState } from 'react'
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
  /** Parent qui a l'enfant ce jour-là : la proposition part par défaut vers l'autre. */
  currentParentId?: number
  onClose: () => void
  onChanged: () => void
}

export default function ExceptionDialog({ householdId, date, members, existing, currentParentId, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const { range: fmtDates, dayLong } = useFormat()
  const solo = isSolo(members)

  const [dateStart, setDateStart] = useState(date)
  const [dateEnd, setDateEnd] = useState(date)
  const [parentId, setParentId] = useState<number>(
    members.find((m) => m.id !== currentParentId)?.id ?? members[0]?.id ?? 0,
  )
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
    return fmtDates(e.date_start, e.date_end)
  }

  // Échap ferme la fenêtre.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

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
    if (!dateStart || !dateEnd || dateEnd < dateStart) {
      setError(t('exchange.errorDates'))
      return
    }
    return run(async () => {
      await api.createException(householdId, {
        date_start: dateStart,
        date_end: dateEnd,
        parent_id: parentId,
        note,
        ...(replacesId !== null ? { replaces_id: replacesId } : {}),
      })
      // Contre-proposition : l'originale n'est refusée qu'une fois la nouvelle envoyée
      // (fermer la fenêtre entre-temps ne perd plus la proposition initiale).
      if (replacesId !== null) await api.refuseExchange(householdId, replacesId)
    })
  }

  // Prépare une contre-proposition : pré-remplit le formulaire, sans rien envoyer.
  function startCounter(e: ScheduleException) {
    setError(null)
    setReplacesId(e.id)
    setDateStart(e.date_start)
    setDateEnd(e.date_end)
    setParentId(members.find((m) => m.id !== e.parent_id)?.id ?? e.parent_id)
    setNote('')
  }

  const toAnswer = overlapping.some((e) => e.status === 'pending' && e.created_by !== user?.id)
  const title = solo
    ? t('exchange.titleSolo')
    : replacesId !== null
      ? t('exchange.titleCounter')
      : toAnswer
        ? t('exchange.titleToAnswer')
        : t('exchange.titlePropose')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sheet ph-mask ph-sensitive" role="dialog" aria-modal="true" aria-labelledby="xdlg-title" onClick={(ev) => ev.stopPropagation()}>
        <p className="eyebrow">{dayLong(date)}</p>
        <h2 id="xdlg-title">{title}</h2>

        {overlapping.map((e) => {
          const iAmProposer = user?.id === e.created_by
          return (
            <div key={e.id} className="card inset">
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
                <div className="actions">
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
                  {/* Deux parents réels : l'annulation devient une demande à valider par l'autre. */}
                  {solo ? t('exchange.cancelExchange') : t('exchange.requestCancel')}
                </button>
              )}
            </div>
          )
        })}

        {replacesId !== null && (
          <div className="info-banner">{t('exchange.counterBanner')}</div>
        )}
        {toAnswer && replacesId === null && <p className="section-label">{t('exchange.orProposeOther')}</p>}

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
        <div className="actions" style={{ marginTop: 18 }}>
          <button onClick={create} disabled={busy}>
            {solo ? t('exchange.save') : replacesId !== null ? t('exchange.sendCounter') : t('exchange.propose')}
          </button>
          <button className="secondary" onClick={onClose}>
            {t('exchange.close')}
          </button>
        </div>
        <p className="fine-print">
          {solo ? t('exchange.footerSolo') : t('exchange.footerPropose')}
        </p>
      </div>
    </div>
  )
}
