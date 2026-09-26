// Dates « calendaires » (YYYY-MM-DD) manipulées en heure locale.
// Ne jamais passer par toISOString() : en Europe/Paris elle recule d'un jour
// entre minuit et 2 h (UTC+1/+2).

export function isoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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

/** « sam. 26 sept. » */
export function fmtDay(iso: string): string {
  return parseIso(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** « 26 sept. 2026 » */
export function fmtDate(iso: string): string {
  return parseIso(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** « samedi 26 septembre » */
export function fmtDayLong(iso: string): string {
  return parseIso(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Plage lisible : « sam. 26 sept. » ou « sam. 26 → lun. 28 sept. » */
export function fmtRange(start: string, end: string): string {
  if (start === end) return fmtDay(start)
  return `${fmtDay(start)} → ${fmtDay(end)}`
}

/** Horodatage serveur (UTC naïf) → « 26 sept., 14:05 » */
export function fmtTimestamp(ts: string): string {
  const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z')
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** « aujourd'hui », « demain », « dans 3 jours » */
export function relativeDays(n: number): string {
  if (n <= 0) return "aujourd'hui"
  if (n === 1) return 'demain'
  return `dans ${n} jours`
}
