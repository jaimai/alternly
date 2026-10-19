import type { TFunction } from 'i18next'
import type { RecurringRule, RecurringRuleInput } from './types'

/** Version à renvoyer à l'API (sans l'identifiant). */
export function ruleInput(r: RecurringRule | RecurringRuleInput): RecurringRuleInput {
  return {
    kind: r.kind,
    parent_id: r.parent_id,
    weekdays: r.weekdays ?? null,
    every_other_week: r.every_other_week ?? false,
    anchor_date: r.anchor_date ?? null,
    include_vacations: r.include_vacations ?? false,
    start_md: r.start_md ?? null,
    end_md: r.end_md ?? null,
    alternate: r.alternate ?? false,
  }
}

/** « 07-01 » → « 1 juillet » dans la langue de l'interface. */
function monthDay(md: string, locale: string): string {
  const [m, d] = md.split('-').map(Number)
  return new Date(2024, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

/** Prochaine année où la période revient (celle en cours si elle n'est pas finie). */
function nextYear(endMd: string): number {
  const now = new Date()
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return md > endMd ? now.getFullYear() + 1 : now.getFullYear()
}

/**
 * Phrase courte : « Chaque mercredi · chez l'autre parent · hors vacances ».
 * `who` donne « chez … » pour un parent ; `otherOf` l'autre parent du foyer.
 */
export function describeRule(
  t: TFunction,
  locale: string,
  r: RecurringRuleInput,
  who: (parentId: number) => string,
  otherOf: (parentId: number) => number,
): string {
  if (r.kind === 'weekly') {
    const days = (r.weekdays ?? []).map((d) => t(`recurring.day${d}`)).join(', ')
    const parts = [t(r.every_other_week ? 'recurring.everyOther' : 'recurring.every', { days }), who(r.parent_id)]
    if (!r.include_vacations) parts.push(t('recurring.outsideHolidays'))
    return parts.join(' · ')
  }
  const range = t('recurring.range', { start: monthDay(r.start_md ?? '01-01', locale), end: monthDay(r.end_md ?? '01-01', locale) })
  if (!r.alternate) return [range, who(r.parent_id), t('recurring.everyYear')].join(' · ')
  // En alternance, parent_id est le parent des années paires : on dit qui l'a la prochaine fois.
  const year = nextYear(r.end_md ?? '12-31')
  const parent = year % 2 === 0 ? r.parent_id : otherOf(r.parent_id)
  return [range, t('recurring.alternateFrom', { who: who(parent), year })].join(' · ')
}
