// Dates « calendaires » (YYYY-MM-DD) en heure locale — même logique que frontend/src/dates.ts.
// Ne jamais passer par toISOString() : en Europe/Paris elle recule d'un jour entre minuit et 2 h.

export function isoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** « 2026-09-26 » → Date locale à midi (à l'abri des changements d'heure). */
export function parseIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return isoLocal(d)
}

export function todayIso(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return isoLocal(d)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000)
}

/** Horodatage serveur (UTC naïf, sans « Z ») → Date. */
export function parseTimestamp(ts: string): Date {
  return new Date(ts.endsWith('Z') || /[+-]\d\d:\d\d$/.test(ts) ? ts : ts + 'Z')
}

/** Premier jour du mois de `iso`. */
export function monthStart(iso: string): string {
  return iso.slice(0, 8) + '01'
}

export function addMonths(iso: string, n: number): string {
  const d = parseIso(monthStart(iso))
  d.setMonth(d.getMonth() + n)
  return isoLocal(d)
}

/** Lundi de la semaine contenant `iso`. */
export function weekStart(iso: string): string {
  const dow = (parseIso(iso).getDay() + 6) % 7 // lundi = 0
  return addDays(iso, -dow)
}

/** Grille du mois (semaines complètes, lundi → dimanche) : 35 ou 42 dates. */
export function monthGrid(iso: string): string[] {
  const first = monthStart(iso)
  const start = weekStart(first)
  const last = addDays(addMonths(first, 1), -1)
  const end = addDays(weekStart(last), 6)
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

const LOCALE = 'fr-FR'

/** « vendredi 9 octobre » */
export function formatLong(iso: string): string {
  return parseIso(iso).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** « ven. 9 oct. » */
export function formatShort(iso: string): string {
  return parseIso(iso).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** « octobre 2026 » */
export function formatMonth(iso: string): string {
  return parseIso(iso).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })
}

/** « 9 → 12 oct. » ou « 30 sept. → 2 oct. » */
export function formatRange(start: string, end: string): string {
  if (start === end) return parseIso(start).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  const a = parseIso(start).toLocaleDateString(LOCALE, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  const b = parseIso(end).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
  return `${a} → ${b}`
}

/** Horodatage relatif court : « à l'instant », « il y a 2 h », « hier », « 3 oct. ». */
export function formatAgo(ts: string, now: Date = new Date()): string {
  const d = parseTimestamp(ts)
  const min = Math.round((now.getTime() - d.getTime()) / 60_000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24 && isoLocal(d) === isoLocal(now)) return `il y a ${h} h`
  const days = daysBetween(isoLocal(d), isoLocal(now))
  if (days === 1) return 'hier'
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
}
