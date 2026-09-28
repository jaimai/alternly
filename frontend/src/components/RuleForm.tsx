import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { mondayOf, sideOn } from '../custodyPreview'
import type { Side } from '../custodyPreview'
import { addDays, parseIso, todayIso } from '../dates'
import { isSolo } from '../members'
import type { CustodyRule, Member, Pattern, VacationRule } from '../types'

const PATTERN_OPTIONS: Pattern[] = ['alternate_weeks', 'two_two_three', 'every_other_weekend', 'custom']

const PATTERN_KEY: Record<Pattern, string> = {
  alternate_weeks: 'AlternateWeeks',
  two_two_three: 'TwoTwoThree',
  every_other_weekend: 'EveryOtherWeekend',
  custom: 'Custom',
}

export interface RuleFormValue {
  custody: {
    pattern: Pattern
    start_date: string
    reference_parent_id: number
    handover_day: number
    handover_time: string
    custom_weeks: string[] | null
  }
  vacation: VacationRule
}

interface Props {
  members: Member[]
  myId: number
  initialCustody?: CustodyRule | null
  initialVacation?: VacationRule | null
  submitLabel: string
  busy?: boolean
  /** Message affiché sous le bouton après un enregistrement réussi (tant que rien n'a changé depuis). */
  savedMessage?: string | null
  onSubmit: (value: RuleFormValue) => void
}

export default function RuleForm({
  members,
  myId,
  initialCustody,
  initialVacation,
  submitLabel,
  busy,
  savedMessage,
  onSubmit,
}: Props) {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState<Pattern>(initialCustody?.pattern ?? 'alternate_weeks')
  const [startDate, setStartDate] = useState(initialCustody?.start_date ?? todayIso())
  const [referenceParent, setReferenceParent] = useState<number>(initialCustody?.reference_parent_id ?? myId)
  const [handoverDay, setHandoverDay] = useState<number>(initialCustody?.handover_day ?? 0)
  const [handoverTime, setHandoverTime] = useState(initialCustody?.handover_time ?? '18:00')
  const [customWeeks, setCustomWeeks] = useState<string[]>(
    initialCustody?.custom_weeks ?? Array.from({ length: 14 }, (_, i) => (i < 7 ? 'ref' : 'other')),
  )
  const [vacMode, setVacMode] = useState<'split_half' | 'alternate_full'>(initialVacation?.mode ?? 'split_half')
  const [evenParent, setEvenParent] = useState<number>(
    initialVacation?.even_year_first_half_parent_id ?? myId,
  )

  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null)

  const soloNote = isSolo(members)

  const value: RuleFormValue = {
    custody: {
      pattern,
      start_date: startDate,
      reference_parent_id: referenceParent,
      handover_day: handoverDay,
      handover_time: handoverTime,
      custom_weeks: pattern === 'custom' ? customWeeks : null,
    },
    vacation: { mode: vacMode, even_year_first_half_parent_id: evenParent },
  }
  const current = JSON.stringify(value)
  // Réglages : rien à enregistrer tant que le formulaire correspond aux règles en place.
  const unchanged =
    !!initialCustody &&
    current ===
      JSON.stringify({
        custody: {
          pattern: initialCustody.pattern,
          start_date: initialCustody.start_date,
          reference_parent_id: initialCustody.reference_parent_id,
          handover_day: initialCustody.handover_day,
          handover_time: initialCustody.handover_time,
          custom_weeks: initialCustody.pattern === 'custom' ? initialCustody.custom_weeks : null,
        },
        vacation: {
          mode: initialVacation?.mode ?? 'split_half',
          even_year_first_half_parent_id: initialVacation?.even_year_first_half_parent_id ?? myId,
        },
      })
  const showSaved = !!savedMessage && lastSubmitted === current

  // Couleurs et prénoms des deux côtés du rythme (le second parent peut être
  // un « placeholder » tant qu'il n'a pas rejoint le foyer).
  const refMember = members.find((m) => m.id === referenceParent)
  const otherMember = members.find((m) => m.id !== referenceParent)
  const sideMember = (side: Side) => (side === 'ref' ? refMember : otherMember)
  const sideName = (side: Side) => sideMember(side)?.display_name ?? (side === 'ref' ? t('rules.me') : t('rules.otherParent'))
  const sideColor = (side: Side) => sideMember(side)?.color ?? (side === 'ref' ? 'var(--pine)' : 'var(--ink-soft)')

  // Aperçu : cette semaine et la suivante, du lundi au dimanche.
  const thisMonday = mondayOf(todayIso())
  const previewWeeks = [0, 1].map((w) => Array.from({ length: 7 }, (_, i) => addDays(thisMonday, w * 7 + i)))

  const DAY_NAMES = [
    t('rules.weekdayMon'),
    t('rules.weekdayTue'),
    t('rules.weekdayWed'),
    t('rules.weekdayThu'),
    t('rules.weekdayFri'),
    t('rules.weekdaySat'),
    t('rules.weekdaySun'),
  ]
  const DAY_SHORT = [
    t('rules.weekdayShortMon'),
    t('rules.weekdayShortTue'),
    t('rules.weekdayShortWed'),
    t('rules.weekdayShortThu'),
    t('rules.weekdayShortFri'),
    t('rules.weekdayShortSat'),
    t('rules.weekdayShortSun'),
  ]

  // Index du jour dans le cycle personnalisé de 14 jours (ancré au lundi de départ).
  function customIndex(day: string) {
    const n = Math.round((parseIso(day).getTime() - parseIso(mondayOf(startDate)).getTime()) / 86_400_000)
    return ((n % 14) + 14) % 14
  }

  function toggleCustom(i: number) {
    setCustomWeeks((weeks) => weeks.map((v, j) => (j === i ? (v === 'ref' ? 'other' : 'ref') : v)))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (busy) return
        setLastSubmitted(current)
        onSubmit(value)
      }}
    >
      <h2>{t('rules.custodyScheduleTitle')}</h2>
      <div className="choice-list">
        {PATTERN_OPTIONS.map((opt) => (
          <label key={opt} className={`choice ${pattern === opt ? 'selected' : ''}`}>
            <input
              type="radio"
              name="pattern"
              checked={pattern === opt}
              onChange={() => setPattern(opt)}
            />
            <span>
              <strong>{t(`rules.pattern${PATTERN_KEY[opt]}Title`)}</strong>
              <div className="desc">{t(`rules.pattern${PATTERN_KEY[opt]}Desc`)}</div>
            </span>
          </label>
        ))}
      </div>

      <div className="row">
        <div>
          <label htmlFor="start">{t('rules.startDateLabel')}</label>
          <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="refparent">
            {pattern === 'every_other_weekend' ? t('rules.weekendParentLabel') : t('rules.referenceParentLabel')}
          </label>
          <select id="refparent" value={referenceParent} onChange={(e) => setReferenceParent(Number(e.target.value))}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {pattern === 'alternate_weeks' && (
        <div className="row">
          <div>
            <label htmlFor="hday">{t('rules.handoverDayLabel')}</label>
            <select id="hday" value={handoverDay} onChange={(e) => setHandoverDay(Number(e.target.value))}>
              {DAY_NAMES.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="htime">{t('rules.handoverTimeLabel')}</label>
            <input id="htime" type="time" value={handoverTime} onChange={(e) => setHandoverTime(e.target.value)} />
          </div>
        </div>
      )}

      <div className="rule-preview" aria-live="polite">
        <div className="rule-preview-head">
          <strong>{pattern === 'custom' ? t('rules.customCycleLabel') : t('rules.previewTitle')}</strong>
          <span className="rule-preview-legend">
            {(['ref', 'other'] as Side[]).map((side) => (
              <span key={side} className="legend-item">
                <span className="dot" style={{ background: sideColor(side) }} />
                {sideName(side)}
              </span>
            ))}
          </span>
        </div>
        {pattern === 'custom' && <p className="hint">{t('rules.customHint')}</p>}
        {previewWeeks.map((week, w) => (
          <div key={w} className="rule-preview-week">
            <span className="rule-preview-label">{w === 0 ? t('rules.previewThisWeek') : t('rules.previewNextWeek')}</span>
            <div className="rule-preview-days">
              {week.map((day, i) => {
                const side: Side =
                  pattern === 'custom'
                    ? customWeeks[customIndex(day)] === 'other'
                      ? 'other'
                      : 'ref'
                    : sideOn(value.custody, day)
                const title = t('rules.previewDayTitle', { day: DAY_NAMES[i], date: parseIso(day).getDate(), parent: sideName(side) })
                const content = (
                  <>
                    <span className="rule-preview-dow">{DAY_SHORT[i]}</span>
                    <span className="rule-preview-num">{parseIso(day).getDate()}</span>
                  </>
                )
                return pattern === 'custom' ? (
                  <button
                    key={day}
                    type="button"
                    className="rule-preview-day editable"
                    style={{ background: sideColor(side) }}
                    onClick={() => toggleCustom(customIndex(day))}
                    title={title}
                    aria-label={title}
                  >
                    {content}
                  </button>
                ) : (
                  <span key={day} className="rule-preview-day" style={{ background: sideColor(side) }} title={title}>
                    {content}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>{t('rules.vacationsTitle')}</h2>
      <div className="choice-list">
        <label className={`choice ${vacMode === 'split_half' ? 'selected' : ''}`}>
          <input type="radio" name="vac" checked={vacMode === 'split_half'} onChange={() => setVacMode('split_half')} />
          <span>
            <strong>{t('rules.vacSplitHalfTitle')}</strong>
            <div className="desc">
              {t('rules.vacSplitHalfDesc')}
            </div>
          </span>
        </label>
        <label className={`choice ${vacMode === 'alternate_full' ? 'selected' : ''}`}>
          <input
            type="radio"
            name="vac"
            checked={vacMode === 'alternate_full'}
            onChange={() => setVacMode('alternate_full')}
          />
          <span>
            <strong>{t('rules.vacAlternateFullTitle')}</strong>
            <div className="desc">{t('rules.vacAlternateFullDesc')}</div>
          </span>
        </label>
      </div>
      <label htmlFor="evenparent">
        {vacMode === 'split_half'
          ? t('rules.evenYearFirstHalfLabel')
          : t('rules.evenYearVacationLabel')}
      </label>
      <select id="evenparent" value={evenParent} onChange={(e) => setEvenParent(Number(e.target.value))}>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name}
          </option>
        ))}
      </select>

      {soloNote && (
        <div className="info-banner">
          {t('rules.soloNote')}
        </div>
      )}

      <p style={{ marginTop: 20 }}>
        <button type="submit" disabled={busy || unchanged} style={{ width: '100%' }}>
          {busy ? t('rules.saving') : unchanged && !showSaved ? t('rules.upToDate') : submitLabel}
        </button>
      </p>
      {showSaved && (
        <div className="rule-saved" role="status">
          <span>{savedMessage}</span>
          <Link to="/app">{t('rules.seeCalendar')}</Link>
        </div>
      )}
    </form>
  )
}
