// Aperçu du rythme de garde pendant la saisie (onboarding).
// Portage de frontend/src/custodyPreview.ts, lui-même fidèle à base_pattern_parent
// (backend/app/services/custody_engine.py) : rythme de base seulement, sans
// vacances, fériés ni échanges. Le calendrier réel reste calculé par le backend.
import { addDays, daysBetween, parseIso } from './dates'

export type Pattern = 'alternate_weeks' | 'two_two_three' | 'every_other_weekend' | 'custom'
export type Side = 'ref' | 'other'

export interface PreviewRule {
  pattern: Pattern
  start_date: string
  handover_day: number // 0 = lundi
  custom_weeks: string[] | null
}

// Motif 2-2-3 standard sur 14 jours, ancré au lundi (identique au moteur).
const TWO_TWO_THREE: Side[] = [
  'ref', 'ref', 'other', 'other', 'ref', 'ref', 'ref',
  'other', 'other', 'ref', 'ref', 'other', 'other', 'other',
]

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Jour de la semaine façon Python : 0 = lundi … 6 = dimanche. */
export function weekday(iso: string): number {
  return mod(parseIso(iso).getDay() - 1, 7)
}

export function mondayOf(iso: string): string {
  return addDays(iso, -weekday(iso))
}

export function sideOn(rule: PreviewRule, day: string): Side {
  switch (rule.pattern) {
    case 'alternate_weeks': {
      const offset = mod(weekday(rule.start_date) - rule.handover_day, 7)
      const cycleStart = addDays(rule.start_date, -offset)
      const weeks = Math.floor(daysBetween(cycleStart, day) / 7)
      return mod(weeks, 2) === 0 ? 'ref' : 'other'
    }
    case 'two_two_three':
      return TWO_TWO_THREE[mod(daysBetween(mondayOf(rule.start_date), day), 14)]
    case 'every_other_weekend': {
      if (weekday(day) < 4) return 'other'
      const weeks = Math.floor(daysBetween(mondayOf(rule.start_date), mondayOf(day)) / 7)
      return mod(weeks, 2) === 0 ? 'ref' : 'other'
    }
    case 'custom': {
      const weeks = rule.custom_weeks
      if (!weeks || weeks.length !== 14) return 'ref'
      return weeks[mod(daysBetween(mondayOf(rule.start_date), day), 14)] === 'other' ? 'other' : 'ref'
    }
  }
}

/**
 * Toucher un jour de l'aperçu le donne à l'autre parent. Un rythme standard est
 * d'abord converti en cycle personnalisé de 14 jours (comme le web).
 */
export function flipDay(rule: PreviewRule, day: string): Side[] {
  const anchor = mondayOf(rule.start_date)
  const cycle: Side[] =
    rule.pattern === 'custom' && rule.custom_weeks?.length === 14
      ? (rule.custom_weeks as Side[]).slice()
      : Array.from({ length: 14 }, (_, i) => sideOn(rule, addDays(anchor, i)))
  const i = mod(daysBetween(anchor, day), 14)
  cycle[i] = cycle[i] === 'ref' ? 'other' : 'ref'
  return cycle
}
