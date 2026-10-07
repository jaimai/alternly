import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { mondayOf, sideOn, weekday } from '../custodyPreview'
import type { Side } from '../custodyPreview'
import { addDays, daysBetween, parseIso, todayIso } from '../dates'
import { useFormat } from '../format'
import type { CustodyRule, Member, Pattern, VacationRule } from '../types'
import type { RuleFormValue } from './RuleForm'

// Ordre de présentation : du plus courant au plus libre (« Autre organisation »).
const PATTERNS: Pattern[] = ['alternate_weeks', 'every_other_weekend', 'two_two_three', 'custom']

const PATTERN_KEY: Record<Pattern, string> = {
  alternate_weeks: 'Alternate',
  every_other_weekend: 'Weekend',
  two_two_three: 'TwoTwoThree',
  custom: 'Custom',
}

/** Vignette de 2 semaines (lundi → dimanche) : a = un parent, b = l'autre, x = à définir. */
const THUMBS: Record<Pattern, string> = {
  alternate_weeks: 'aaaaaaabbbbbbb',
  every_other_weekend: 'bbbbaaabbbbbbb',
  two_two_three: 'aabbaaabbaabbb',
  custom: 'xxxxxxxxxxxxxx',
}

const DEFAULT_CUSTOM: Side[] = Array.from({ length: 14 }, (_, i) => (i < 7 ? 'ref' : 'other'))

interface Props {
  members: Member[]
  myId: number
  childNames: string[]
  initialCustody?: CustodyRule | null
  initialVacation?: VacationRule | null
  busy?: boolean
  onSubmit: (value: RuleFormValue) => void
}

/**
 * Règle de garde à l'inscription, en 4 petites étapes (une question par écran) :
 * rythme (avec vignettes) → qui a l'enfant à une date précise → vérifier et
 * ajuster jour par jour → vacances. Les réglages gardent le formulaire complet.
 */
export default function RuleWizard({ members, myId, childNames, initialCustody, initialVacation, busy, onSubmit }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const me = members.find((m) => m.id === myId)
  const other = members.find((m) => m.id !== myId)

  const [step, setStep] = useState(0)
  const [pattern, setPattern] = useState<Pattern>(initialCustody?.pattern ?? 'alternate_weeks')
  const [startDate, setStartDate] = useState(initialCustody?.start_date ?? todayIso())
  const [showDate, setShowDate] = useState(false)
  const [referenceParent, setReferenceParent] = useState<number>(initialCustody?.reference_parent_id ?? myId)
  const [handoverDay, setHandoverDay] = useState<number>(initialCustody?.handover_day ?? 0)
  const [handoverTime, setHandoverTime] = useState(initialCustody?.handover_time ?? '18:00')
  const [customWeeks, setCustomWeeks] = useState<Side[]>(
    (initialCustody?.custom_weeks as Side[] | null | undefined) ?? DEFAULT_CUSTOM,
  )
  const [vacMode, setVacMode] = useState<'split_half' | 'alternate_full'>(initialVacation?.mode ?? 'split_half')
  const [evenParent, setEvenParent] = useState<number>(initialVacation?.even_year_first_half_parent_id ?? myId)
  // Dernier jour touché à l'étape 3, et l'état d'avant pour « Annuler ».
  const [adjust, setAdjust] = useState<{
    day: string
    before: { pattern: Pattern; customWeeks: Side[] }
  } | null>(null)

  const kids = childNames.length === 1 ? childNames[0] : childNames.length > 1 ? t('wizard.theChildren') : t('wizard.theChild')

  const rule = { pattern, start_date: startDate, handover_day: handoverDay, custom_weeks: customWeeks }
  const anchor = mondayOf(startDate)
  const cycleIndex = (day: string) => ((daysBetween(anchor, day) % 14) + 14) % 14
  const sideOf = (day: string): Side => sideOn(rule, day)
  const memberOf = (side: Side) =>
    side === 'ref' ? members.find((m) => m.id === referenceParent) : members.find((m) => m.id !== referenceParent)
  const colorOf = (side: Side) => memberOf(side)?.color ?? (side === 'ref' ? 'var(--pine)' : 'var(--terra)')
  const nameOf = (side: Side) => {
    const m = memberOf(side)
    if (!m) return t('rules.otherParent')
    return m.id === myId ? t('wizard.you', { name: m.display_name }) : m.is_placeholder ? t('rules.otherParent') : m.display_name
  }

  const thisMonday = mondayOf(todayIso())
  const weeks = [0, 1].map((w) => Array.from({ length: 7 }, (_, i) => addDays(thisMonday, w * 7 + i)))
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => t(`rules.weekdayShort${d}`))
  const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => t(`rules.weekday${d}`))

  // Question datée de l'étape 2, selon le rythme.
  function whoQuestion(): string {
    switch (pattern) {
      case 'alternate_weeks': {
        const offset = (((weekday(startDate) - handoverDay) % 7) + 7) % 7
        return t('wizard.whoAlternate', { child: kids, date: fmt.dayLong(addDays(startDate, -offset)) })
      }
      case 'every_other_weekend':
        return t('wizard.whoWeekend', { child: kids, date: fmt.dayLong(addDays(anchor, 5)) })
      default:
        return t('wizard.whoTwoTwoThree', { child: kids, date: fmt.dayLong(anchor) })
    }
  }

  /** Toucher un jour le donne à l'autre parent ; un rythme standard devient « personnalisé ». */
  function flipDay(day: string) {
    const before = { pattern, customWeeks }
    const cycle: Side[] =
      pattern === 'custom'
        ? [...customWeeks]
        : Array.from({ length: 14 }, (_, i) => sideOn(rule, addDays(anchor, i)))
    const i = cycleIndex(day)
    cycle[i] = cycle[i] === 'ref' ? 'other' : 'ref'
    if (pattern !== 'custom') track(EV.ruleDayAdjusted, { from_pattern: pattern })
    setCustomWeeks(cycle)
    setPattern('custom')
    setAdjust((prev) => ({ day, before: prev?.before ?? before }))
  }

  function undo() {
    if (!adjust) return
    setPattern(adjust.before.pattern)
    setCustomWeeks(adjust.before.customWeeks)
    setAdjust(null)
  }

  // Vacances : la question porte sur l'année en cours ; le moteur, lui, retient
  // le parent qui a la 1re moitié (ou les vacances) les années paires.
  const year = new Date().getFullYear()
  const evenYear = year % 2 === 0
  const otherId = (id: number) => members.find((m) => m.id !== id)?.id ?? id
  const thisYearParent = evenYear ? evenParent : otherId(evenParent)
  const setThisYearParent = (id: number) => setEvenParent(evenYear ? id : otherId(id))

  function submit() {
    if (busy) return
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
  }

  function next() {
    track(EV.ruleWizardStep, { step: ['pattern', 'who', 'check', 'vacations'][step], pattern })
    // « Autre organisation » : pas de question « qui a l'enfant », on place les jours directement.
    setStep(step === 0 && pattern === 'custom' ? 2 : step + 1)
  }

  function back() {
    setStep(step === 2 && pattern === 'custom' && !adjust ? 0 : step - 1)
  }

  const thumb = (p: Pattern) =>
    [0, 1].map((w) => (
      <span key={w} className="wz-thumb-row">
        {THUMBS[p]
          .slice(w * 7, w * 7 + 7)
          .split('')
          .map((c, i) => (
            <span key={i} className={`wz-thumb-cell ${c}`} />
          ))}
      </span>
    ))

  const header = (
    <>
      <div className="wz-top">
        {step > 0 ? (
          <button type="button" className="link wz-back" onClick={back}>
            ← {t('wizard.back')}
          </button>
        ) : (
          <span />
        )}
        <span className="wz-count">{t('wizard.progress', { n: step + 1 })}</span>
      </div>
      <div className="wz-progress" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>
    </>
  )

  const preview = (editable: boolean) => (
    <div className="wz-preview">
      {weeks.map((week, w) => (
        <div key={w} className="wz-week">
          <span className="wz-week-label">{t('wizard.weekOf', { date: fmt.dayLong(week[0]) })}</span>
          <div className="wz-days">
            {week.map((day, i) => {
              const side = sideOf(day)
              const label = t('rules.previewDayTitle', { day: DAY[i], date: parseIso(day).getDate(), parent: nameOf(side) })
              const content = (
                <>
                  <span className="wz-dow">{DOW[i]}</span>
                  <span className="wz-num">{parseIso(day).getDate()}</span>
                </>
              )
              return editable ? (
                <button
                  key={day}
                  type="button"
                  className={`wz-day editable${adjust?.day === day ? ' touched' : ''}`}
                  style={{ background: colorOf(side) }}
                  onClick={() => flipDay(day)}
                  aria-label={`${label}. ${t('wizard.tapToChange')}`}
                >
                  {content}
                </button>
              ) : (
                <span key={day} className="wz-day" style={{ background: colorOf(side) }} title={label}>
                  {content}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  const legend = (
    <div className="wz-legend">
      {(['ref', 'other'] as Side[]).map((side) => (
        <span key={side}>
          <span className="dot" style={{ background: colorOf(side) }} />
          {nameOf(side)}
        </span>
      ))}
    </div>
  )

  return (
    <div className="wz">
      {header}

      {step === 0 && (
        <>
          <h2 className="wz-title">{t('wizard.patternTitle')}</h2>
          <p className="wz-sub">{t('wizard.patternSub')}</p>
          <div className="wz-options" role="radiogroup" aria-label={t('wizard.patternTitle')}>
            {PATTERNS.map((p) => (
              <label key={p} className={`wz-option${pattern === p ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="wz-pattern"
                  checked={pattern === p}
                  onChange={() => {
                    setPattern(p)
                    setAdjust(null)
                  }}
                />
                <span className="wz-option-text">
                  <strong>{t(`wizard.pattern${PATTERN_KEY[p]}Title`)}</strong>
                  <span>{t(`wizard.pattern${PATTERN_KEY[p]}Desc`)}</span>
                </span>
                <span className="wz-thumb" aria-hidden="true">
                  {thumb(p)}
                </span>
              </label>
            ))}
          </div>
          <p className="wz-hint">{t('wizard.thumbLegend')}</p>
        </>
      )}

      {step === 1 && (
        <>
          <h2 className="wz-title">{whoQuestion()}</h2>
          {pattern === 'every_other_weekend' && <p className="wz-sub">{t('wizard.weekendSub', { child: kids })}</p>}
          <div className="wz-who">
            {[me, other].filter((m): m is Member => !!m).map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={referenceParent === m.id}
                className={`wz-who-btn${referenceParent === m.id ? ' selected' : ''}`}
                onClick={() => setReferenceParent(m.id)}
              >
                <span className="wz-avatar" style={{ background: m.color }}>
                  {m.is_placeholder ? '?' : m.display_name.charAt(0).toUpperCase()}
                </span>
                <strong>{m.id === myId ? t('wizard.me') : t('rules.otherParent')}</strong>
                <span>{m.id === myId ? m.display_name : m.is_placeholder ? t('wizard.notInvitedYet') : m.display_name}</span>
              </button>
            ))}
          </div>
          {pattern === 'alternate_weeks' && (
            <div className="row">
              <div>
                <label htmlFor="wz-hday">{t('rules.handoverDayLabel')}</label>
                <select id="wz-hday" value={handoverDay} onChange={(e) => setHandoverDay(Number(e.target.value))}>
                  {DAY.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wz-htime">{t('rules.handoverTimeLabel')}</label>
                <input id="wz-htime" type="time" value={handoverTime} onChange={(e) => setHandoverTime(e.target.value)} />
              </div>
            </div>
          )}
          <div className="wz-card">
            <div className="wz-card-head">
              <strong>{t('rules.previewTitle')}</strong>
              <span>{t('wizard.liveUpdate')}</span>
            </div>
            {preview(false)}
          </div>
          {showDate ? (
            <div>
              <label htmlFor="wz-start">{t('rules.startDateLabel')}</label>
              <input id="wz-start" type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
            </div>
          ) : (
            <p className="wz-hint">
              {t('wizard.otherDateQuestion')}{' '}
              <button type="button" className="link wz-inline-link" onClick={() => setShowDate(true)}>
                {t('wizard.otherDate')}
              </button>
            </p>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="wz-title">{t('wizard.checkTitle')}</h2>
          <p className="wz-sub">{t('wizard.checkSub')}</p>
          {legend}
          <div className="wz-card">{preview(true)}</div>
          {adjust && (
            <div className="wz-toast" role="status">
              <div>
                <strong>
                  {t('wizard.dayMoved', {
                    day: fmt.dayLong(adjust.day),
                    parent: nameOf(sideOf(adjust.day)),
                  })}
                </strong>
                <span>{t('wizard.nowCustom')}</span>
              </div>
              <button type="button" onClick={undo}>
                {t('wizard.undo')}
              </button>
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="wz-title">{t('wizard.vacTitle')}</h2>
          <div className="wz-options">
            {(['split_half', 'alternate_full'] as const).map((mode) => {
              const first = colorOf(thisYearParent === referenceParent ? 'ref' : 'other')
              const second = colorOf(thisYearParent === referenceParent ? 'other' : 'ref')
              const bars =
                mode === 'split_half'
                  ? [`linear-gradient(90deg, ${first} 0 50%, ${second} 50% 100%)`, `linear-gradient(90deg, ${second} 0 50%, ${first} 50% 100%)`]
                  : [first, second]
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={vacMode === mode}
                  className={`wz-option wz-vac${vacMode === mode ? ' selected' : ''}`}
                  onClick={() => setVacMode(mode)}
                >
                  <span className="wz-option-text">
                    <strong>{t(mode === 'split_half' ? 'wizard.vacHalfTitle' : 'wizard.vacFullTitle')}</strong>
                    <span>{t(mode === 'split_half' ? 'wizard.vacHalfDesc' : 'wizard.vacFullDesc')}</span>
                  </span>
                  <span className="wz-bars" aria-hidden="true">
                    {bars.map((bg, i) => (
                      <span key={i} className="wz-bar-row">
                        <span>{year + i}</span>
                        <span className="wz-bar" style={{ background: bg }} />
                      </span>
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="wz-question">
            {t(vacMode === 'split_half' ? 'wizard.vacWhoHalf' : 'wizard.vacWhoFull', { year })}
          </p>
          <div className="wz-who compact">
            {[me, other].filter((m): m is Member => !!m).map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={thisYearParent === m.id}
                className={`wz-chip${thisYearParent === m.id ? ' selected' : ''}`}
                onClick={() => setThisYearParent(m.id)}
              >
                {m.id === myId ? t('wizard.me') : t('rules.otherParent')}
              </button>
            ))}
          </div>
          <p className="wz-example">
            {t(`wizard.vacExample${vacMode === 'split_half' ? 'Half' : 'Full'}${thisYearParent === myId ? 'Me' : 'Other'}`)}
          </p>
        </>
      )}

      <div className="wz-footer">
        {step < 3 ? (
          <button type="button" onClick={next} style={{ width: '100%' }}>
            {step === 2 ? t('wizard.checkContinue') : t('onboarding.continue')}
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={busy} style={{ width: '100%' }}>
            {busy ? t('rules.saving') : t('onboarding.generateCalendar')}
          </button>
        )}
      </div>
    </div>
  )
}
