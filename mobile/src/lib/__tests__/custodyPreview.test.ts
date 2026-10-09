import { flipDay, mondayOf, sideOn, weekday, type PreviewRule } from '../custodyPreview'

// 5 oct. 2026 = lundi.
const base = { start_date: '2026-10-05', handover_day: 0, custom_weeks: null }

describe('custodyPreview', () => {
  it('calcule le jour de la semaine à la Python (lundi = 0)', () => {
    expect(weekday('2026-10-05')).toBe(0)
    expect(weekday('2026-10-11')).toBe(6)
    expect(mondayOf('2026-10-09')).toBe('2026-10-05')
  })

  it('alterne les semaines à partir du jour de passation', () => {
    const rule: PreviewRule = { ...base, pattern: 'alternate_weeks', handover_day: 4 } // vendredi
    // Le cycle démarre au vendredi précédant (ou égal à) la date de départ : 2 oct.
    expect(sideOn(rule, '2026-10-02')).toBe('ref')
    expect(sideOn(rule, '2026-10-08')).toBe('ref')
    expect(sideOn(rule, '2026-10-09')).toBe('other')
    expect(sideOn(rule, '2026-10-16')).toBe('ref')
  })

  it('suit le motif 2-2-3 sur 14 jours', () => {
    const rule: PreviewRule = { ...base, pattern: 'two_two_three' }
    const two = Array.from({ length: 14 }, (_, i) => sideOn(rule, `2026-10-${String(5 + i).padStart(2, '0')}`))
    expect(two.join(',')).toBe('ref,ref,other,other,ref,ref,ref,other,other,ref,ref,other,other,other')
  })

  it('un week-end sur deux : semaine chez l’autre parent', () => {
    const rule: PreviewRule = { ...base, pattern: 'every_other_weekend' }
    expect(sideOn(rule, '2026-10-08')).toBe('other') // jeudi
    expect(sideOn(rule, '2026-10-09')).toBe('ref') // vendredi de la semaine 0
    expect(sideOn(rule, '2026-10-16')).toBe('other') // vendredi de la semaine 1
  })

  it('convertit en cycle personnalisé quand on touche un jour', () => {
    const rule: PreviewRule = { ...base, pattern: 'alternate_weeks' }
    const cycle = flipDay(rule, '2026-10-07') // mercredi, semaine « ref »
    expect(cycle).toHaveLength(14)
    expect(cycle[2]).toBe('other')
    expect(cycle.filter((s) => s === 'other')).toHaveLength(8)
    const custom: PreviewRule = { ...base, pattern: 'custom', custom_weeks: cycle }
    expect(sideOn(custom, '2026-10-07')).toBe('other')
    expect(sideOn(custom, '2026-10-21')).toBe('other') // 14 jours plus tard
    expect(flipDay(custom, '2026-10-07')[2]).toBe('ref') // re-toucher annule
  })
})
