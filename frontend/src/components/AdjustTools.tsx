import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, isoLocal, parseIso, todayIso } from '../dates'
import type { Member } from '../types'
import Icon from './Icon'

export type AdjustTool = 'day' | 'period'

/** Plus longue période qu'on ajuste d'un coup (un été entier tient dedans). */
export const PERIOD_MAX_DAYS = 120

interface Props {
  members: Member[]
  myId: number | undefined
  tool: AdjustTool
  onTool: (tool: AdjustTool) => void
  brush: number | null
  onBrush: (parentId: number) => void
  /** Met la période chez le parent du pinceau ; renvoie un message d'erreur, sinon null. */
  onApplyPeriod: (start: string, end: string) => Promise<string | null>
}

// Raccourcis de dates : ce week-end, la semaine prochaine, juillet et août à venir.
function shortcuts(today: string) {
  const d = parseIso(today)
  const weekday = (d.getDay() + 6) % 7 // 0 = lundi
  const saturday = weekday === 6 ? addDays(today, -1) : addDays(today, 5 - weekday)
  const nextMonday = addDays(today, 7 - weekday)
  const summerYear = d.getMonth() > 7 ? d.getFullYear() + 1 : d.getFullYear()
  const month = (m: number) => ({
    start: isoLocal(new Date(summerYear, m, 1)),
    end: isoLocal(new Date(summerYear, m + 1, 0)),
  })
  return [
    { key: 'weekend', start: saturday, end: addDays(saturday, 1) },
    { key: 'nextWeek', start: nextMonday, end: addDays(nextMonday, 6) },
    { key: 'july', ...month(6) },
    { key: 'august', ...month(7) },
  ]
}

/** Outils du mode « Ajuster » : pinceau (chez qui) et jour par jour ou période. */
export default function AdjustTools({ members, myId, tool, onTool, brush, onBrush, onApplyPeriod }: Props) {
  const { t } = useTranslation()
  const today = todayIso()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = (m: Member) =>
    m.id === myId ? t('adjust.brushMe') : m.is_placeholder ? t('adjust.brushOther') : t('adjust.brushName', { name: m.display_name })

  async function apply() {
    setError(null)
    if (!start || !end || end < start) {
      setError(t('adjust.periodInvalid'))
      return
    }
    const days = Math.round((parseIso(end).getTime() - parseIso(start).getTime()) / 86_400_000) + 1
    if (days > PERIOD_MAX_DAYS) {
      setError(t('adjust.periodTooLong', { max: PERIOD_MAX_DAYS }))
      return
    }
    setBusy(true)
    const err = await onApplyPeriod(start, end)
    setBusy(false)
    if (err) setError(err)
    else {
      setStart('')
      setEnd('')
    }
  }

  return (
    <div className="adjust-tools">
      <div className="segmented adjust-tabs" role="tablist" aria-label={t('adjust.toolLabel')}>
        {(['day', 'period'] as AdjustTool[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tool === k} className={tool === k ? 'on' : ''} onClick={() => onTool(k)}>
            {t(k === 'day' ? 'adjust.toolDay' : 'adjust.toolPeriod')}
          </button>
        ))}
      </div>

      <div className="adjust-brushes" role="radiogroup" aria-label={t('adjust.brushLabel')}>
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={brush === m.id}
            className={`adjust-brush${brush === m.id ? ' on' : ''}`}
            style={brush === m.id ? { borderColor: m.color } : undefined}
            onClick={() => onBrush(m.id)}
          >
            <span className="dot" style={{ background: m.color }} />
            {label(m)}
          </button>
        ))}
      </div>

      {tool === 'day' ? (
        <p className="adjust-tools-hint">
          <Icon name="pencil" size={14} /> {t('adjust.dayHint')}
        </p>
      ) : (
        <div className="adjust-period">
          <div className="adjust-chips">
            {shortcuts(today).map((s) => (
              <button
                key={s.key}
                type="button"
                className={`adjust-chip${start === s.start && end === s.end ? ' on' : ''}`}
                onClick={() => {
                  setStart(s.start)
                  setEnd(s.end)
                  setError(null)
                }}
              >
                {t(`adjust.short_${s.key}`)}
              </button>
            ))}
          </div>
          <div className="row">
            <div>
              <label htmlFor="adj-start">{t('adjust.periodFrom')}</label>
              <input id="adj-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label htmlFor="adj-end">{t('adjust.periodTo')}</label>
              <input id="adj-end" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="button" onClick={apply} disabled={busy || !start || !end}>
            {busy ? t('adjust.periodApplying') : t('adjust.periodApply')}
          </button>
        </div>
      )}
    </div>
  )
}
