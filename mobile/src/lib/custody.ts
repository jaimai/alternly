// Lecture du calendrier résolu par le backend (le moteur de garde reste côté serveur).
import type { CalendarDay, CalendarResponse, Member } from './types'

export interface Handover {
  /** Premier jour chez le nouveau parent. */
  date: string
  to: number
  /** Heure de passation habituelle si le changement vient du rythme normal. */
  time: string | null
}

export interface TodayStatus {
  today: CalendarDay | null
  next: Handover | null
}

export function byDate(days: CalendarDay[]): Map<string, CalendarDay> {
  return new Map(days.map((d) => [d.date, d]))
}

/** Qui a les enfants aujourd'hui, et la prochaine passation dans la plage chargée. */
export function todayStatus(cal: Pick<CalendarResponse, 'days' | 'handover_time'>, today: string): TodayStatus {
  const sorted = [...cal.days].sort((a, b) => a.date.localeCompare(b.date))
  const current = sorted.find((d) => d.date === today) ?? null
  if (!current) return { today: null, next: null }
  const change = sorted.find((d) => d.date > today && d.parent_id !== current.parent_id)
  const next: Handover | null = change
    ? { date: change.date, to: change.parent_id, time: change.source === 'rule' ? cal.handover_time : null }
    : null
  return { today: current, next }
}

export function memberById(members: Member[], id: number | undefined): Member | undefined {
  return members.find((m) => m.id === id)
}

/** « Vous » pour soi, sinon le prénom de l'autre parent. */
export function parentLabel(members: Member[], id: number | undefined, meId: number | undefined): string {
  if (id !== undefined && id === meId) return 'Vous'
  return memberById(members, id)?.display_name ?? "L'autre parent"
}

/** Période de vacances scolaires qui contient `date`, s'il y en a une. */
export function schoolHolidayOn(cal: Pick<CalendarResponse, 'school_holidays'>, date: string) {
  return cal.school_holidays.find((p) => p.start <= date && date <= p.end)
}

export function publicHolidayOn(cal: Pick<CalendarResponse, 'public_holidays'>, date: string) {
  return cal.public_holidays.find((h) => h.date === date)
}

/** Échange en attente qui couvre `date`. */
export function pendingOn(cal: Pick<CalendarResponse, 'pending_exchanges'>, date: string) {
  return cal.pending_exchanges.find((e) => e.date_start <= date && date <= e.date_end)
}

/** Les échanges que j'ai à valider (proposés par l'autre parent). */
export function exchangesToAnswer(cal: Pick<CalendarResponse, 'pending_exchanges'>, meId: number | undefined) {
  return cal.pending_exchanges.filter((e) => e.proposed_by !== meId)
}

/** « Léa », « Léa et Hugo », « Léa, Hugo et Tom » ; « Les enfants » si aucun prénom. */
export function kidsLabel(names: string[]): string {
  if (names.length === 0) return 'Les enfants'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`
}

/** « Léa est chez » / « Léa et Hugo sont chez ». */
export function statusLead(names: string[]): string {
  return `${kidsLabel(names)} ${names.length === 1 ? 'est' : 'sont'} chez`
}

/** « aujourd'hui », « demain », « dans 5 jours ». */
export function relativeDays(n: number): string {
  if (n <= 0) return "aujourd'hui"
  if (n === 1) return 'demain'
  return `dans ${n} jours`
}
