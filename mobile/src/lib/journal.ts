// Journal de garde : libellés, regroupement par mois et texte à partager (mêmes types
// que frontend/src/pages/Journal.tsx). Notes privées : jamais visibles par l'autre parent.
import { parseIso, parseTimestamp } from './dates'
import type { JournalEntry, JournalKind } from './types'

export const JOURNAL_KINDS: JournalKind[] = [
  'handover', 'late', 'missed', 'change', 'health', 'school', 'expense', 'incident', 'other',
]

export const JOURNAL_LABEL: Record<JournalKind, string> = {
  handover: 'Passage de relais',
  late: 'Retard',
  missed: 'Passage manqué',
  change: 'Changement convenu',
  health: 'Santé',
  school: 'École',
  expense: 'Frais',
  incident: 'Incident',
  other: 'Autre',
}

/** « octobre 2026 » → notes du mois, mois les plus récents d'abord (ordre de l'API conservé). */
export function groupByMonth(entries: JournalEntry[]): { month: string; label: string; entries: JournalEntry[] }[] {
  const groups = new Map<string, JournalEntry[]>()
  for (const e of entries) {
    const key = e.day.slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  return [...groups.entries()].map(([month, items]) => {
    const label = parseIso(`${month}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    return { month, label: label.charAt(0).toUpperCase() + label.slice(1), entries: items }
  })
}

/**
 * Journal en texte brut, du plus ancien au plus récent, à partager (e-mail, notes,
 * avocat). Chaque note garde son horodatage de saisie. Le PDF se fait sur le web.
 */
export function journalText(entries: JournalEntry[], author: string, childName: (id: number | null) => string | null): string {
  const stamp = (ts: string) =>
    parseTimestamp(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const lines = [`Journal de garde — ${author}`, '']
  for (const e of [...entries].reverse()) {
    const day = parseIso(e.day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const child = childName(e.child_id)
    lines.push(`${day}${e.time ? ` à ${e.time}` : ''} — ${JOURNAL_LABEL[e.kind]}${child ? ` (${child})` : ''}`)
    lines.push(e.body)
    lines.push(`Saisie le ${stamp(e.created_at)}${e.edited_at ? `, modifiée le ${stamp(e.edited_at)}` : ''}`)
    lines.push('')
  }
  lines.push('Notes personnelles saisies dans Alternly ; ce n’est pas un constat certifié.')
  return lines.join('\n')
}
