// Aperçu du rythme de garde, calculé côté navigateur pendant la saisie.
// Portage fidèle de base_pattern_parent (backend/app/services/custody_engine.py) :
// rythme de base seulement, sans vacances, fériés ni échanges.

import { addDays, daysBetween, parseIso } from './dates'
import type { Pattern } from './types'

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
 * Semaine du cycle personnalisé (0 ou 1) à laquelle appartient la semaine du
 * jour donné : sert à dater les deux lignes de la grille éditable.
 */
export function customCycleWeek(startDate: string, day: string): number {
  return mod(Math.floor(daysBetween(mondayOf(startDate), mondayOf(day)) / 7), 2)
}
