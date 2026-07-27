import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  onSubmit: (value: RuleFormValue) => void
}

export default function RuleForm({ members, myId, initialCustody, initialVacation, submitLabel, busy, onSubmit }: Props) {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState<Pattern>(initialCustody?.pattern ?? 'alternate_weeks')
  const [startDate, setStartDate] = useState(initialCustody?.start_date ?? new Date().toISOString().slice(0, 10))
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

  const soloNote = isSolo(members)

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

  function toggleCustom(i: number) {
    setCustomWeeks((weeks) => weeks.map((v, j) => (j === i ? (v === 'ref' ? 'other' : 'ref') : v)))
  }

  function parentName(id: number) {
    return members.find((m) => m.id === id)?.display_name ?? t('rules.me')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          custody: {
            pattern,
            start_date: startDate,
            reference_parent_id: referenceParent,
            handover_day: handoverDay,
            handover_time: handoverTime,
            custom_weeks: pattern === 'custom' ? customWeeks : null,
          },
          vacation: { mode: vacMode, even_year_first_half_parent_id: evenParent },
        })
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

      {pattern === 'custom' && (
        <>
          <label>{t('rules.customCycleLabel', { parent: parentName(referenceParent) })}</label>
          <div className="custom-grid">
            {customWeeks.map((v, i) => (
              <button
                key={i}
                type="button"
                className={v === 'ref' ? '' : 'secondary'}
                onClick={() => toggleCustom(i)}
                title={t('rules.customDayTitle', { week: i < 7 ? 1 : 2, day: DAY_NAMES[i % 7] })}
              >
                {DAY_SHORT[i % 7]}
              </button>
            ))}
          </div>
        </>
      )}

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
        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? t('rules.saving') : submitLabel}
        </button>
      </p>
    </form>
  )
}
