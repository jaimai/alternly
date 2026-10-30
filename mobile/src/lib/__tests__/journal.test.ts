import { groupByMonth, journalText } from '../journal'
import type { JournalEntry } from '../types'

function entry(id: number, day: string, extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id, day, time: null, kind: 'late', child_id: null, body: `Note ${id}`,
    created_at: `${day}T18:00:00`, edited_at: null, ...extra,
  }
}

// Ordre de l'API : plus récent d'abord.
const entries = [entry(3, '2026-10-26', { time: '18:40', child_id: 9 }), entry(2, '2026-10-02'), entry(1, '2026-09-30', { kind: 'health' })]
const childName = (id: number | null) => (id === 9 ? 'Léo' : null)

describe('groupByMonth', () => {
  it('regroupe par mois en gardant l’ordre', () => {
    const groups = groupByMonth(entries)
    expect(groups.map((g) => g.month)).toEqual(['2026-10', '2026-09'])
    expect(groups[0].entries.map((e) => e.id)).toEqual([3, 2])
    expect(groups[0].label.toLowerCase()).toContain('2026')
  })
})

describe('journalText', () => {
  it('liste les notes du plus ancien au plus récent, avec type, enfant et heure', () => {
    const text = journalText(entries, 'Camille', childName)
    expect(text.startsWith('Journal de garde — Camille')).toBe(true)
    expect(text.indexOf('Note 1')).toBeLessThan(text.indexOf('Note 3'))
    expect(text).toContain('à 18:40 — Retard (Léo)')
    expect(text).toContain('Santé')
    expect(text).toContain('pas un constat certifié')
  })
})
