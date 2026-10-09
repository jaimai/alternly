import { exchangesToAnswer, isSolo, kidsLabel, parentLabel, pendingOn, relativeDays, statusLead, todayStatus, whoName } from '../custody'
import type { CalendarDay, Member, PendingExchange } from '../types'

const ME = 1
const JULIE = 2
const members: Member[] = [
  { id: ME, display_name: 'Thomas', color: '#2f6b57', role: 'parent1', is_placeholder: false },
  { id: JULIE, display_name: 'Julie', color: '#c96f4a', role: 'parent2', is_placeholder: false },
]

function days(spec: [string, number, CalendarDay['source']?][]): CalendarDay[] {
  return spec.map(([date, parent_id, source = 'rule']) => ({ date, parent_id, source }))
}

describe('todayStatus', () => {
  it('trouve le parent du jour et la prochaine passation du rythme', () => {
    const cal = {
      handover_time: '18:00',
      days: days([
        ['2026-10-10', JULIE],
        ['2026-10-08', ME],
        ['2026-10-09', ME],
      ]),
    }
    const s = todayStatus(cal, '2026-10-08')
    expect(s.today?.parent_id).toBe(ME)
    expect(s.next).toEqual({ date: '2026-10-10', to: JULIE, time: '18:00' })
  })

  it("n'annonce pas l'heure habituelle pour un changement dû aux vacances", () => {
    const cal = { handover_time: '18:00', days: days([['2026-10-16', ME], ['2026-10-17', JULIE, 'vacation']]) }
    expect(todayStatus(cal, '2026-10-16').next).toEqual({ date: '2026-10-17', to: JULIE, time: null })
  })

  it('renvoie null hors de la plage chargée ou sans changement', () => {
    const cal = { handover_time: '18:00', days: days([['2026-10-08', ME], ['2026-10-09', ME]]) }
    expect(todayStatus(cal, '2026-10-01')).toEqual({ today: null, next: null })
    expect(todayStatus(cal, '2026-10-08').next).toBeNull()
  })
})

describe('échanges', () => {
  const pending: PendingExchange[] = [
    { id: 1, date_start: '2026-10-24', date_end: '2026-10-25', proposed_parent_id: JULIE, proposed_by: JULIE, note: '' },
    { id: 2, date_start: '2026-10-31', date_end: '2026-11-01', proposed_parent_id: ME, proposed_by: ME, note: '' },
  ]

  it("ne garde que ceux proposés par l'autre parent", () => {
    expect(exchangesToAnswer({ pending_exchanges: pending }, ME).map((e) => e.id)).toEqual([1])
  })

  it('retrouve l’échange qui couvre un jour', () => {
    expect(pendingOn({ pending_exchanges: pending }, '2026-10-25')?.id).toBe(1)
    expect(pendingOn({ pending_exchanges: pending }, '2026-10-26')).toBeUndefined()
  })
})

describe('parentLabel', () => {
  it('dit « Vous » pour soi et le prénom pour l’autre', () => {
    expect(parentLabel(members, ME, ME)).toBe('Vous')
    expect(parentLabel(members, JULIE, ME)).toBe('Julie')
    expect(parentLabel(members, 99, ME)).toBe('L’autre parent')
    const placeholder = [members[0], { ...members[1], display_name: "L'autre parent", is_placeholder: true }]
    expect(whoName(placeholder, JULIE, ME)).toBe('l’autre parent')
    expect(whoName(members, JULIE, ME)).toBe('Julie')
    expect(whoName(members, ME, ME)).toBe('vous')
  })
})

describe('libellés', () => {
  it('énumère les enfants', () => {
    expect(kidsLabel([])).toBe('Les enfants')
    expect(kidsLabel(['Léa'])).toBe('Léa')
    expect(kidsLabel(['Léa', 'Hugo', 'Tom'])).toBe('Léa, Hugo et Tom')
    expect(statusLead(['Léa'])).toBe('Léa est chez')
    expect(statusLead(['Léa', 'Hugo'])).toBe('Léa et Hugo sont chez')
    expect(statusLead([])).toBe('Les enfants sont chez')
    expect(relativeDays(0)).toBe("aujourd'hui")
    expect(relativeDays(1)).toBe('demain')
    expect(relativeDays(5)).toBe('dans 5 jours')
  })
})

describe('isSolo', () => {
  it('ignore le second parent pas encore inscrit', () => {
    expect(isSolo(members)).toBe(false)
    expect(isSolo([members[0], { ...members[1], is_placeholder: true }])).toBe(true)
    expect(isSolo([members[0]])).toBe(true)
  })
})
