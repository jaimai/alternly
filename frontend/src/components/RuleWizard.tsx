import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { mondayOf, sideOn, weekday } from '../custodyPreview'
import type { Side } from '../custodyPreview'
import { addDays, daysBetween, parseIso, todayIso } from '../dates'
import { useFormat } from '../format'
import type { CustodyRule, Member, Pattern, VacationMode, VacationPeriodModes, VacationRule } from '../types'
import type { RuleFormValue } from './RuleForm'
import VacationPicker from './VacationPicker'
import { CURRENT, CycleDrawer, MonthCheck, TEMPLATES, TemplatePicker, templateCells } from './CustomRhythm'
import type { Cell } from './CustomRhythm'

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

const VAC_KEY: Record<VacationMode, string> = { split_half: 'Half', alternate_full: 'Full', july_august: 'JulyAugust', weekly: 'Weekly' }

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
  const [vacMode, setVacMode] = useState<VacationMode>(initialVacation?.mode ?? 'split_half')
  const [periodModes, setPeriodModes] = useState<VacationPeriodModes>(initialVacation?.period_modes ?? {})
  const [evenParent, setEvenParent] = useState<number>(initialVacation?.even_year_first_half_parent_id ?? myId)
  // Dernier jour touché à l'étape 3, et l'état d'avant pour « Annuler ».
  const [adjust, setAdjust] = useState<{
    day: string
    before: { pattern: Pattern; customWeeks: Side[] }
  } | null>(null)
  // « Autre organisation » : modèle proche (étape 2), puis grille à corriger et aperçu du mois (étape 3).
  const [customFlow, setCustomFlow] = useState(false)
  // Rythme personnalisé déjà enregistré, vu depuis « vous » (côté ref = le parent connecté).
  const [currentCells] = useState<Cell[] | null>(() =>
    initialCustody?.pattern === 'custom' && initialCustody.custom_weeks?.length === 14
      ? (initialCustody.custom_weeks as Side[]).map((x) =>
          initialCustody.reference_parent_id === myId ? x : x === 'ref' ? 'other' : 'ref',
        )
      : null,
  )
  const [template, setTemplate] = useState(currentCells ? CURRENT : 0)
  const [cells, setCells] = useState<Cell[]>(() => currentCells ?? templateCells(0))
  const cellsOf = (i: number) => (i === CURRENT && currentCells ? currentCells : templateCells(i))
  const templateId = template === CURRENT ? 'current' : TEMPLATES[template].id
  const [cellsFrom, setCellsFrom] = useState<number | null>(null)
  const [brush, setBrush] = useState<Side>('other')
  const [monthView, setMonthView] = useState(false)

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
      vacation: {
        mode: vacMode,
        even_year_first_half_parent_id: evenParent,
        period_modes: Object.keys(periodModes).length ? periodModes : null,
      },
    })
  }

  function customStepName() {
    if (step === 1) return 'template'
    if (step === 2) return monthView ? 'month' : 'draw'
    return 'vacations'
  }

  function next() {
    if (customFlow && step > 0) {
      track(EV.ruleWizardStep, { step: customStepName(), pattern, template: templateId })
      if (step === 1) {
        // Le parent qui s'inscrit est le côté « ref » de la grille.
        if (cellsFrom !== template) {
          setCells(cellsOf(template))
          setCellsFrom(template)
          setBrush(templateId === 'blank' ? 'ref' : 'other')
        }
        setMonthView(false)
        setStep(2)
      } else if (step === 2 && !monthView) {
        if (cells.some((c) => c === null)) return
        setCustomWeeks(cells as Side[])
        setMonthView(true)
      } else {
        setStep(step + 1)
      }
      return
    }
    track(EV.ruleWizardStep, { step: ['pattern', 'who', 'check', 'vacations'][step], pattern })
    if (step === 0) {
      const custom = pattern === 'custom'
      setCustomFlow(custom)
      if (custom) setReferenceParent(myId)
    }
    setStep(step + 1)
  }

  function back() {
    if (customFlow && step === 2 && monthView) setMonthView(false)
    else setStep(step - 1)
  }

  const atLabel = (side: Side) => {
    const m = memberOf(side)
    if (m?.id === myId) return t('wizard.customAtYou')
    return m && !m.is_placeholder ? t('wizard.customAtName', { name: m.display_name }) : t('wizard.customAtOther')
  }

  function footerLabel() {
    if (customFlow && step === 1) return t('wizard.customUseTemplate')
    if (customFlow && step === 2) return monthView ? t('wizard.checkContinue') : t('wizard.customSeeMonth')
    return step === 2 ? t('wizard.checkContinue') : t('onboarding.continue')
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

      {customFlow && step === 1 && <TemplatePicker template={template} onPick={setTemplate} current={currentCells} colorOf={colorOf} atLabel={atLabel} />}

      {customFlow && step === 2 && !monthView && (
        <CycleDrawer
          cells={cells}
          onChange={setCells}
          brush={brush}
          onBrush={setBrush}
          startDate={startDate}
          onStartDate={setStartDate}
          template={template}
          onReset={() => setCells(cellsOf(template))}
          colorOf={colorOf}
          atLabel={atLabel}
        />
      )}

      {customFlow && step === 2 && monthView && (
        <MonthCheck cells={customWeeks} startDate={startDate} colorOf={colorOf} atLabel={atLabel} />
      )}

      {!customFlow && step === 1 && (
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

      {!customFlow && step === 2 && (
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
          <VacationPicker
            mode={vacMode}
            onMode={setVacMode}
            periodModes={periodModes}
            onPeriodModes={setPeriodModes}
            first={colorOf(thisYearParent === referenceParent ? 'ref' : 'other')}
            second={colorOf(thisYearParent === referenceParent ? 'other' : 'ref')}
            year={year}
          />
          <p className="wz-question">
            {t(`wizard.vacWho${VAC_KEY[vacMode]}`, { year })}
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
            {t(`wizard.vacExample${VAC_KEY[vacMode]}${thisYearParent === myId ? 'Me' : 'Other'}`)}
          </p>
        </>
      )}

      <div className="wz-footer">
        {step < 3 ? (
          <>
            <button
              type="button"
              onClick={next}
              disabled={customFlow && step === 2 && !monthView && cells.some((c) => c === null)}
              style={{ width: '100%' }}
            >
              {footerLabel()}
            </button>
            {customFlow && step === 2 && monthView && (
              <button type="button" className="link cr-again" onClick={() => setMonthView(false)}>
                {t('wizard.customFixAgain')}
              </button>
            )}
          </>
        ) : (
          <button type="button" onClick={submit} disabled={busy} style={{ width: '100%' }}>
            {busy ? t('rules.saving') : t('onboarding.generateCalendar')}
          </button>
        )}
      </div>
    </div>
  )
}
