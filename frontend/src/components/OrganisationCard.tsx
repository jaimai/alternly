import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, isPendingChange } from '../api'
import { describeRule, ruleInput } from '../recurring'
import type { Household, Pattern, VacationMode } from '../types'

const PATTERN_KEY: Record<Pattern, string> = {
  alternate_weeks: 'AlternateWeeks',
  two_two_three: 'TwoTwoThree',
  every_other_weekend: 'EveryOtherWeekend',
  custom: 'Custom',
}
const VAC_KEY: Record<VacationMode, string> = { split_half: 'Half', alternate_full: 'Full', july_august: 'JulyAugust', weekly: 'Weekly' }

interface Props {
  household: Household
  myId: number
  /** Après une modification : recharger le foyer. */
  onChanged: () => void
}

/**
 * « Mon organisation » : les règles du foyer empilées, de la plus précise
 * (qui l'emporte) au rythme habituel.
 */
export default function OrganisationCard({ household, myId, onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const rules = household.recurring_rules ?? []
  const otherOf = (id: number) => household.members.find((m) => m.id !== id)?.id ?? id
  const who = (id: number) => {
    const m = household.members.find((x) => x.id === id)
    if (id === myId) return t('adjust.brushMe').toLowerCase()
    return m && !m.is_placeholder ? t('adjust.recapWho', { name: m.display_name }) : t('adjust.brushOther').toLowerCase()
  }
  const specials = household.special_day_rules.filter((r) => r.enabled).length
  const vac = household.vacation_rule

  async function remove(index: number) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api.setRecurringRules(household.id, rules.filter((_, i) => i !== index).map(ruleInput))
      setMessage(isPendingChange(res) ? t('organisation.removeProposed') : t('organisation.removed'))
      onChanged()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('calendar.genericError'))
    } finally {
      setBusy(false)
    }
  }

  const ruleList = (kind: 'weekly' | 'yearly') => {
    const list = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === kind)
    if (list.length === 0) return null
    return (
      <ul className="org-rules">
        {list.map(({ r, i }) => (
          <li key={r.id}>
            <span>{describeRule(t, i18n.language, r, who, otherOf)}</span>
            <button type="button" className="link danger-link" disabled={busy} onClick={() => remove(i)}>
              {t('organisation.remove')}
            </button>
          </li>
        ))}
      </ul>
    )
  }

  const layers: { kind: string; title: string; detail?: string; action?: React.ReactNode; body?: React.ReactNode }[] = [
    { kind: t('organisation.layerAdjusted'), title: t('organisation.adjustedTitle'), action: <Link to="/app">{t('organisation.openCalendar')}</Link> },
    {
      kind: t('organisation.layerSpecial'),
      title: specials ? t('organisation.specialCount', { count: specials }) : t('organisation.none'),
      action: <a href="#special-days">{t('organisation.edit')}</a>,
    },
    {
      kind: t('organisation.layerYearly'),
      title: rules.some((r) => r.kind === 'yearly') ? '' : t('organisation.none'),
      body: ruleList('yearly'),
      detail: t('organisation.yearlyHint'),
    },
    {
      kind: t('organisation.layerHolidays'),
      title: vac ? t(`wizard.vac${VAC_KEY[vac.mode]}Title`) : t('organisation.none'),
      detail: vac?.period_modes && Object.keys(vac.period_modes).length ? t('organisation.periodByPeriod') : undefined,
      action: <a href="#rules-form">{t('organisation.edit')}</a>,
    },
    {
      kind: t('organisation.layerWeekly'),
      title: rules.some((r) => r.kind === 'weekly') ? '' : t('organisation.none'),
      body: ruleList('weekly'),
      detail: t('organisation.weeklyHint'),
    },
  ]

  return (
    <div className="card organisation">
      <h2>{t('organisation.title')}</h2>
      <p className="hint">{t('organisation.intro')}</p>
      <ol className="org-layers">
        {layers.map((l, i) => (
          <li key={l.kind}>
            <span className="org-rank">{i + 1}</span>
            <span className="org-text">
              <span className="org-kind">{l.kind}</span>
              {l.title && <strong>{l.title}</strong>}
              {l.body}
              {l.detail && <span className="org-detail">{l.detail}</span>}
            </span>
            {l.action}
          </li>
        ))}
        <li>
          <span className="org-rank base">{layers.length + 1}</span>
          <span className="org-text">
            <span className="org-kind">{t('organisation.layerBase')}</span>
            <strong>
              {household.custody_rule ? t(`rules.pattern${PATTERN_KEY[household.custody_rule.pattern]}Title`) : t('organisation.none')}
            </strong>
          </span>
          <a href="#rules-form">{t('organisation.edit')}</a>
        </li>
      </ol>
      {message && <p className="hint" role="status">{message}</p>}
    </div>
  )
}
