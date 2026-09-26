import { api } from './api'
import type { CalendarResponse, ScheduleException } from './types'

// Cache mémoire « stale-while-revalidate » du calendrier : revenir sur l'écran
// affiche immédiatement les dernières données connues, puis les rafraîchit en
// arrière-plan. Vidé pour un foyer dès qu'une modification y est faite.
const calendars = new Map<string, CalendarResponse>()
const exceptions = new Map<number, ScheduleException[]>()
const MAX_ENTRIES = 40

const key = (householdId: number, start: string, end: string) => `${householdId}:${start}:${end}`

export function cachedCalendar(householdId: number, start: string, end: string): CalendarResponse | undefined {
  return calendars.get(key(householdId, start, end))
}

export async function fetchCalendar(householdId: number, start: string, end: string): Promise<CalendarResponse> {
  const data = await api.calendar(householdId, start, end)
  const k = key(householdId, start, end)
  calendars.delete(k)
  calendars.set(k, data)
  // Borne la mémoire : on oublie les plages les plus anciennes.
  while (calendars.size > MAX_ENTRIES) calendars.delete(calendars.keys().next().value as string)
  return data
}

export function cachedExceptions(householdId: number): ScheduleException[] | undefined {
  return exceptions.get(householdId)
}

export async function fetchExceptions(householdId: number): Promise<ScheduleException[]> {
  const list = await api.listExceptions(householdId)
  exceptions.set(householdId, list)
  return list
}

/** Tout oublier (changement de règles, de zone, de compte…). */
export function invalidateAllCalendars() {
  calendars.clear()
  exceptions.clear()
}

/** À appeler après toute modification du planning (échange, règle, changement accepté…). */
export function invalidateCalendar(householdId: number) {
  for (const k of [...calendars.keys()]) if (k.startsWith(`${householdId}:`)) calendars.delete(k)
  exceptions.delete(householdId)
}
