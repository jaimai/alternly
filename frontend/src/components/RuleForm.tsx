import { useState } from 'react'
import type { CustodyRule, Member, Pattern, VacationRule } from '../types'

const PATTERN_OPTIONS: { value: Pattern; title: string; desc: string }[] = [
  {
    value: 'alternate_weeks',
    title: 'Semaine / semaine',
    desc: "L'enfant change de foyer chaque semaine, au jour et à l'heure choisis.",
  },
  {
    value: 'two_two_three',
    title: '2-2-3',
    desc: '2 jours chez un parent, 2 jours chez l’autre, puis 3 jours (week-end compris). Alterné chaque semaine.',
  },
  {
    value: 'every_other_weekend',
    title: 'Un week-end sur deux',
    desc: 'Résidence principale chez un parent ; l’autre accueille l’enfant un week-end sur deux (ven-dim).',
  },
  {
    value: 'custom',
    title: 'Personnalisé',
    desc: 'Définissez jour par jour un cycle de deux semaines.',
  },
]

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

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

  const soloNote = members.length < 2

  function toggleCustom(i: number) {
    setCustomWeeks((weeks) => weeks.map((v, j) => (j === i ? (v === 'ref' ? 'other' : 'ref') : v)))
  }

  function parentName(id: number) {
    return members.find((m) => m.id === id)?.display_name ?? 'Moi'
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
      <h2>Rythme de garde</h2>
      <div className="choice-list">
        {PATTERN_OPTIONS.map((opt) => (
          <label key={opt.value} className={`choice ${pattern === opt.value ? 'selected' : ''}`}>
            <input
              type="radio"
              name="pattern"
              checked={pattern === opt.value}
              onChange={() => setPattern(opt.value)}
            />
            <span>
              <strong>{opt.title}</strong>
              <div className="desc">{opt.desc}</div>
            </span>
          </label>
        ))}
      </div>

      <div className="row">
        <div>
          <label htmlFor="start">Date de départ du rythme</label>
          <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="refparent">
            {pattern === 'every_other_weekend' ? 'Parent qui a les week-ends' : 'Qui a l’enfant au départ ?'}
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
            <label htmlFor="hday">Jour de changement</label>
            <select id="hday" value={handoverDay} onChange={(e) => setHandoverDay(Number(e.target.value))}>
              {DAY_NAMES.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="htime">Heure de passage</label>
            <input id="htime" type="time" value={handoverTime} onChange={(e) => setHandoverTime(e.target.value)} />
          </div>
        </div>
      )}

      {pattern === 'custom' && (
        <>
          <label>Cycle de 2 semaines — cliquez pour basculer chaque jour ({parentName(referenceParent)} en bleu)</label>
          <div className="custom-grid">
            {customWeeks.map((v, i) => (
              <button
                key={i}
                type="button"
                className={v === 'ref' ? '' : 'secondary'}
                onClick={() => toggleCustom(i)}
                title={`Semaine ${i < 7 ? 1 : 2} — ${DAY_NAMES[i % 7]}`}
              >
                {DAY_SHORT[i % 7]}
              </button>
            ))}
          </div>
        </>
      )}

      <h2 style={{ marginTop: 24 }}>Vacances scolaires</h2>
      <div className="choice-list">
        <label className={`choice ${vacMode === 'split_half' ? 'selected' : ''}`}>
          <input type="radio" name="vac" checked={vacMode === 'split_half'} onChange={() => setVacMode('split_half')} />
          <span>
            <strong>Partage par moitié</strong>
            <div className="desc">
              Chaque période de vacances est coupée en deux ; l'ordre s'inverse entre années paires et impaires.
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
            <strong>Vacances entières alternées</strong>
            <div className="desc">Toute la période chez un parent, en alternance selon l'année paire ou impaire.</div>
          </span>
        </label>
      </div>
      <label htmlFor="evenparent">
        {vacMode === 'split_half'
          ? 'Années paires : qui a la première moitié ?'
          : 'Années paires : qui a les vacances ?'}
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
          Vous êtes seul·e pour l'instant : le calendrier fonctionne déjà. Invitez l'autre parent depuis les
          réglages quand vous serez prêt·e.
        </div>
      )}

      <p style={{ marginTop: 20 }}>
        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Enregistrement…' : submitLabel}
        </button>
      </p>
    </form>
  )
}
