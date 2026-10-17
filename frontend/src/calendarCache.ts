import { api } from './api'
import { addDays, isoLocal, parseIso, todayIso } from './dates'
import type { CalendarResponse, ScheduleException } from './types'

// Cache mémoire « stale-while-revalidate » du calendrier : revenir sur l'écran
// affiche immédiatement les dernières données connues, puis les rafraîchit en
// arrière-plan. Vidé pour un foyer dès qu'une modification y est faite.
const calendars = new Map<string, CalendarResponse>()
// Requêtes en cours : un préchargement et l'écran qui en a besoin partagent la même.
const inflight = new Map<string, Promise<CalendarResponse>>()
const exceptions = new Map<number, ScheduleException[]>()
// Date de réception de chaque plage : une donnée toute fraîche (préchargement au
// démarrage) n'est pas redemandée aussitôt par l'écran qui l'affiche.
const fetchedAt = new Map<string, number>()
const FRESH_MS = 30_000
const MAX_ENTRIES = 40

const key = (householdId: number, start: string, end: string) => `${householdId}:${start}:${end}`

export function cachedCalendar(householdId: number, start: string, end: string): CalendarResponse | undefined {
  return calendars.get(key(householdId, start, end))
}

export function fetchCalendar(householdId: number, start: string, end: string): Promise<CalendarResponse> {
  const k = key(householdId, start, end)
  const pending = inflight.get(k)
  if (pending) return pending
  const fresh = calendars.get(k)
  if (fresh && Date.now() - (fetchedAt.get(k) ?? 0) < FRESH_MS) return Promise.resolve(fresh)
  const p = api
    .calendar(householdId, start, end)
    .then((data) => {
      calendars.delete(k)
      calendars.set(k, data)
      fetchedAt.set(k, Date.now())
      // Borne la mémoire : on oublie les plages les plus anciennes.
      while (calendars.size > MAX_ENTRIES) calendars.delete(calendars.keys().next().value as string)
      return data
    })
    .finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}

/** Plage affichée par la vue mois du calendrier (semaines du lundi au dimanche,
 *  sans semaine fixe) : même calcul que FullCalendar (firstDay=1, fixedWeekCount=false). */
export function monthGridRange(day: string = todayIso()): { start: string; end: string } {
  const d = parseIso(day)
  const first = isoLocal(new Date(d.getFullYear(), d.getMonth(), 1))
  const last = isoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  const weekday = (iso: string) => (parseIso(iso).getDay() + 6) % 7 // 0 = lundi
  return { start: addDays(first, -weekday(first)), end: addDays(last, 6 - weekday(last)) }
}

/** Plage de la carte « Aujourd'hui » (prochain passage, à venir). */
export const STATUS_HORIZON_DAYS = 75
export function statusRange(): { start: string; end: string } {
  const today = todayIso()
  return { start: today, end: addDays(today, STATUS_HORIZON_DAYS) }
}

/** Démarre le chargement de la carte « Aujourd'hui » en même temps que le mois. */
export function prefetchStatus(householdId: number) {
  const { start, end } = statusRange()
  if (cachedCalendar(householdId, start, end)) return
  fetchCalendar(householdId, start, end).catch(() => {})
}

// Dernier foyer ouvert sur cet appareil : au démarrage, le calendrier est demandé
// en même temps que le compte et le foyer, sans attendre leur réponse.
const LAST_HOUSEHOLD_KEY = 'alternly_last_household'
export function rememberHousehold(householdId: number) {
  try {
    localStorage.setItem(LAST_HOUSEHOLD_KEY, String(householdId))
  } catch {
    // stockage indisponible : pas de préchargement au prochain démarrage
  }
}
export function lastHousehold(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_HOUSEHOLD_KEY))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

/** Démarre le chargement du mois en cours avant même l'affichage du calendrier. */
export function prefetchCurrentMonth(householdId: number) {
  const { start, end } = monthGridRange()
  if (cachedCalendar(householdId, start, end)) return
  fetchCalendar(householdId, start, end).catch(() => {})
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
  inflight.clear()
  exceptions.clear()
}

/** À appeler après toute modification du planning (échange, règle, changement accepté…). */
export function invalidateCalendar(householdId: number) {
  for (const k of [...calendars.keys()]) if (k.startsWith(`${householdId}:`)) calendars.delete(k)
  for (const k of [...inflight.keys()]) if (k.startsWith(`${householdId}:`)) inflight.delete(k)
  exceptions.delete(householdId)
}
