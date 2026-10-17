import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { mondayOf, sideOn, weekday } from '../custodyPreview'
import type { Side } from '../custodyPreview'
import { addDays, parseIso, todayIso } from '../dates'
import { useFormat } from '../format'

/**
 * « Autre organisation » à l'inscription : on part du modèle le plus proche,
 * on corrige les jours qui diffèrent, puis on vérifie sur un mois.
 * Côté « ref » = le parent qui s'inscrit (« vous »).
 */

export type Cell = Side | null

/** Modèles sur 2 semaines (lundi → dimanche) : a = vous, b = l'autre parent, x = à placer. */
export const TEMPLATES = [
  { id: 'two_two_five_five', cells: 'aabbaaaaabbbbb' },
  { id: 'weekdays_weekends', cells: 'aaaabbbaaaabbb' },
  { id: 'weekend_wednesday', cells: 'aabaabbaabaaaa' },
  { id: 'week_week_wednesday', cells: 'aabaaaabbabbbb' },
  { id: 'weekend_evening', cells: 'abaabbbabaaaaa' },
  { id: 'blank', cells: 'xxxxxxxxxxxxxx' },
] as const

const TEMPLATE_KEY: Record<(typeof TEMPLATES)[number]['id'], string> = {
  two_two_five_five: 'TwoTwoFiveFive',
  weekdays_weekends: 'WeekdaysWeekends',
  weekend_wednesday: 'WeekendWednesday',
  week_week_wednesday: 'WeekWeekWednesday',
  weekend_evening: 'WeekendEvening',
  blank: 'Blank',
}

/** Index réservé au rythme personnalisé déjà enregistré (« Recommencer la configuration »). */
export const CURRENT = -1

export function templateCells(index: number): Cell[] {
  return TEMPLATES[index].cells.split('').map((c) => (c === 'a' ? 'ref' : c === 'b' ? 'other' : null))
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface Common {
  colorOf: (side: Side) => string
  /** « chez vous », « chez l'autre parent » ou « chez Marie ». */
  atLabel: (side: Side) => string
}

interface PickerProps extends Common {
  template: number
  onPick: (i: number) => void
  /** Rythme personnalisé déjà en place : proposé en premier pour le retoucher. */
  current?: Cell[] | null
}

export function TemplatePicker({ template, onPick, current, colorOf, atLabel }: PickerProps) {
  const { t } = useTranslation()
  const options = [
    ...(current
      ? [{
          index: CURRENT,
          title: t('wizard.tplCurrentTitle'),
          desc: t('wizard.tplCurrentDesc'),
          cells: current.map((c) => (c === 'ref' ? 'a' : c === 'other' ? 'b' : 'x')).join(''),
        }]
      : []),
    ...TEMPLATES.map((tpl, index) => ({
      index,
      title: t(`wizard.tpl${TEMPLATE_KEY[tpl.id]}Title`),
      desc: t(`wizard.tpl${TEMPLATE_KEY[tpl.id]}Desc`),
      cells: tpl.cells as string,
    })),
  ]
  return (
    <>
      <h2 className="wz-title">{t('wizard.customTemplateTitle')}</h2>
      <p className="wz-sub">{t('wizard.customTemplateSub')}</p>
      <div
        className="wz-options cr-templates"
        role="radiogroup"
        aria-label={t('wizard.customTemplateTitle')}
        style={{ '--cr-a': colorOf('ref'), '--cr-b': colorOf('other') } as CSSProperties}
      >
        {options.map((opt) => (
          <label key={opt.index} className={`wz-option${template === opt.index ? ' selected' : ''}`}>
            <input type="radio" name="wz-template" checked={template === opt.index} onChange={() => onPick(opt.index)} />
            <span className="wz-option-text">
              <strong>{opt.title}</strong>
              <span>{opt.desc}</span>
            </span>
            <span className="wz-thumb" aria-hidden="true">
              {[0, 1].map((w) => (
                <span key={w} className="wz-thumb-row">
                  {opt.cells
                    .slice(w * 7, w * 7 + 7)
                    .split('')
                    .map((c, j) => (
                      <span key={j} className={`wz-thumb-cell ${c}`} />
                    ))}
                </span>
              ))}
            </span>
          </label>
        ))}
      </div>
      <div className="wz-legend wz-hint">
        {(['ref', 'other'] as Side[]).map((side) => (
          <span key={side}>
            <span className="dot" style={{ background: colorOf(side) }} />
            {capitalize(atLabel(side))}
          </span>
        ))}
        <span>{t('wizard.customThumbLegend')}</span>
      </div>
    </>
  )
}

interface DrawProps extends Common {
  cells: Cell[]
  onChange: (cells: Cell[]) => void
  brush: Side
  onBrush: (side: Side) => void
  startDate: string
  onStartDate: (iso: string) => void
  template: number
  onReset: () => void
}

export function CycleDrawer({ cells, onChange, brush, onBrush, startDate, onStartDate, template, onReset, colorOf, atLabel }: DrawProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [editDate, setEditDate] = useState(false)
  const anchor = mondayOf(startDate)
  const blank = template !== CURRENT && TEMPLATES[template].id === 'blank'
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => t(`rules.weekdayShort${d}`))
  const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => t(`rules.weekday${d}`))

  const missing = cells.filter((c) => c === null).length
  const mine = cells.filter((c) => c === 'ref').length
  // Passages du cycle : jours où l'enfant change de foyer (le cycle boucle sur lui-même).
  const handovers: string[] = []
  if (!missing) {
    cells.forEach((c, i) => {
      if (c !== cells[(i + 13) % 14]) {
        handovers.push(t('wizard.customHandoverDay', { day: DAY[i % 7].toLowerCase(), week: i < 7 ? 1 : 2 }))
      }
    })
  }

  return (
    <>
      <h2 className="wz-title">{t(blank ? 'wizard.customDrawBlankTitle' : 'wizard.customDrawTitle')}</h2>
      <p className="wz-sub">{t('wizard.customDrawSub')}</p>

      <div className="cr-brushes" role="radiogroup" aria-label={t('rules.customBrushLabel')}>
        {(['ref', 'other'] as Side[]).map((side) => (
          <button
            key={side}
            type="button"
            role="radio"
            aria-checked={brush === side}
            className={`cr-brush${brush === side ? ' selected' : ''}`}
            style={brush === side ? { borderColor: colorOf(side) } : undefined}
            onClick={() => onBrush(side)}
          >
            <span className="cr-brush-dot" style={{ background: colorOf(side) }} />
            <strong>{capitalize(atLabel(side))}</strong>
          </button>
        ))}
      </div>

      <div className="wz-card">
        {[0, 1].map((w) => (
          <div key={w} className="wz-week">
            <span className="wz-week-label">{t('wizard.customWeekN', { n: w + 1 })}</span>
            <div className="wz-days">
              {cells.slice(w * 7, w * 7 + 7).map((c, j) => {
                const i = w * 7 + j
                const day = addDays(anchor, i)
                const where = c ? atLabel(c) : t('wizard.customUnset')
                return (
                  <button
                    key={i}
                    type="button"
                    className={`wz-day editable${c ? '' : ' cr-unset'}`}
                    style={c ? { background: colorOf(c) } : undefined}
                    onClick={() => onChange(cells.map((v, k) => (k === i ? brush : v)))}
                    aria-label={`${DAY[j]} ${parseIso(day).getDate()} : ${where}`}
                  >
                    <span className="wz-dow">{DOW[j]}</span>
                    <span className="wz-num">{parseIso(day).getDate()}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {editDate ? (
          <div>
            <label htmlFor="cr-start">{t('wizard.customStartLabel')}</label>
            <input id="cr-start" type="date" value={startDate} onChange={(e) => e.target.value && onStartDate(e.target.value)} />
          </div>
        ) : (
          <p className="wz-hint">
            {t('wizard.customStartNote', { date: fmt.dayLong(anchor) })}{' '}
            <button type="button" className="link wz-inline-link" onClick={() => setEditDate(true)}>
              {t('wizard.customStartChange')}
            </button>
          </p>
        )}
      </div>

      <div className="cr-summary" role="status">
        {missing ? (
          <strong>{t('wizard.customMissing', { count: missing })}</strong>
        ) : (
          <>
            <strong>{t('wizard.customCounts', { mine, other: 14 - mine })}</strong>
            <span>
              {handovers.length
                ? t('wizard.customHandovers', { count: handovers.length, list: handovers.join(', ') })
                : t('wizard.customNoHandover')}
            </span>
          </>
        )}
      </div>

      <button type="button" className="link cr-reset" onClick={onReset}>
        {blank ? t('wizard.customClear') : t('wizard.customReset')}
      </button>
    </>
  )
}

interface MonthProps extends Common {
  cells: Side[]
  startDate: string
}

export function MonthCheck({ cells, startDate, colorOf, atLabel }: MonthProps) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat()
  const rule = { pattern: 'custom' as const, start_date: startDate, handover_day: 0, custom_weeks: cells }
  const today = todayIso()
  const first = `${today.slice(0, 8)}01`
  const days: string[] = []
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) days.push(d)
  const sides = days.map((d) => sideOn(rule, d))
  const mine = sides.filter((s) => s === 'ref').length
  const month = parseIso(first).toLocaleDateString(i18n.language, { month: 'long' })
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => t(`rules.weekdayShort${d}`))

  let next: string | null = null
  for (let i = 1; i <= 28 && !next; i++) {
    const d = addDays(today, i)
    if (sideOn(rule, d) !== sideOn(rule, addDays(d, -1))) next = d
  }

  return (
    <>
      <h2 className="wz-title">{t('wizard.customMonthTitle', { month })}</h2>
      <p className="wz-sub">{t('wizard.customMonthSub')}</p>
      <div className="wz-card">
        <div className="cr-month cr-month-head" aria-hidden="true">
          {DOW.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="cr-month">
          {Array.from({ length: weekday(first) }, (_, i) => (
            <span key={`pad${i}`} />
          ))}
          {days.map((d, i) => (
            <span
              key={d}
              className={`cr-month-day${d === today ? ' today' : ''}`}
              style={{ background: colorOf(sides[i]) }}
              title={`${fmt.dayLong(d)} : ${atLabel(sides[i])}`}
            >
              {parseIso(d).getDate()}
            </span>
          ))}
        </div>
      </div>
      <div className="wz-legend">
        {(['ref', 'other'] as Side[]).map((side) => (
          <span key={side}>
            <span className="dot" style={{ background: colorOf(side) }} />
            {t('wizard.customMonthCount', {
              where: capitalize(atLabel(side)),
              count: side === 'ref' ? mine : days.length - mine,
            })}
          </span>
        ))}
      </div>
      {next && (
        <div className="cr-summary">
          <span>{t('wizard.customNextHandover', { date: fmt.dayLong(next), where: atLabel(sideOn(rule, next)) })}</span>
        </div>
      )}
    </>
  )
}
