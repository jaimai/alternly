// Règles qui se répètent : forme envoyée à l'API et phrase courte affichée.
import type { RecurringRule, RecurringRuleInput } from './types'

const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

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

const monthDay = (md: string) => {
  const [m, d] = md.split('-').map(Number)
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]}`
}

/** Prochaine année où la période revient (celle en cours si elle n'est pas finie). */
function nextYear(endMd: string): number {
  const now = new Date()
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return md > endMd ? now.getFullYear() + 1 : now.getFullYear()
}

/** « Chaque mercredi · chez l'autre parent · hors vacances ». */
export function describeRule(r: RecurringRuleInput, who: (parentId: number) => string, otherOf: (parentId: number) => number): string {
  if (r.kind === 'weekly') {
    const days = (r.weekdays ?? []).map((d) => DAYS[d]).join(', ')
    const parts = [r.every_other_week ? `Un ${days} sur deux` : `Chaque ${days}`, who(r.parent_id)]
    if (!r.include_vacations) parts.push('hors vacances')
    return parts.join(' · ')
  }
  const range = `Du ${monthDay(r.start_md ?? '01-01')} au ${monthDay(r.end_md ?? '01-01')}`
  if (!r.alternate) return [range, who(r.parent_id), 'tous les ans'].join(' · ')
  // En alternance, parent_id est le parent des années paires : on dit qui l'a la prochaine fois.
  const year = nextYear(r.end_md ?? '12-31')
  return `${range} · ${who(year % 2 === 0 ? r.parent_id : otherOf(r.parent_id))} en ${year}, puis en alternance`
}
