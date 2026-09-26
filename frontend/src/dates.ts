// Dates « calendaires » (YYYY-MM-DD) manipulées en heure locale.
// Ne jamais passer par toISOString() : en Europe/Paris elle recule d'un jour
// entre minuit et 2 h (UTC+1/+2), et aux US elle avance d'un jour le soir.
// Le formatage localisé (FR/EN) passe par useFormat() (format.ts).

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
