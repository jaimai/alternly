import { amountInput, balanceLabel, formatMoney, groupExpenses, parseAmount, sharePresets } from '../expenses'
import type { Expense, Member } from '../types'

const members: Member[] = [
  { id: 1, display_name: 'Camille', color: '#2f6b57', role: 'parent1', is_placeholder: false },
  { id: 2, display_name: 'Alex', color: '#c96f4a', role: 'parent2', is_placeholder: false },
]
const plain = (s: string) => s.replace(/[  ]/g, ' ')

function expense(id: number, date: string, settled = false): Expense {
  return {
    id, label: `D${id}`, amount_cents: 1000, date, category: 'autre', child_id: null, paid_by: 1,
    payer_percent: 50, status: 'active', dispute_note: '', settled_at: settled ? '2026-10-01T10:00:00' : null, created_by: 1,
  }
}

describe('parseAmount', () => {
  it('accepte virgule, point et espaces', () => {
    expect(parseAmount('24,50')).toBe(2450)
    expect(parseAmount('24.5')).toBe(2450)
    expect(parseAmount('1 200')).toBe(120000)
    expect(parseAmount('1 200,10')).toBe(120010)
  })
  it('refuse vide, zéro et texte', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
  it('refuse les formats ambigus plutôt que de deviner', () => {
    expect(parseAmount('1,200.50')).toBeNull()
    expect(parseAmount('1.200,50')).toBeNull()
    expect(parseAmount('12abc')).toBeNull()
    expect(parseAmount('12,345')).toBeNull()
  })
  it('se relit depuis amountInput', () => {
    expect(parseAmount(amountInput(2450))).toBe(2450)
  })
})

describe('balanceLabel', () => {
  const base = { net: [], owed_to_me_cents: 0, i_owe_cents: 0 }
  it('comptes à jour', () => {
    expect(balanceLabel({ ...base, debtor_id: null, creditor_id: null, amount_cents: 0 }, members, 1, 'EUR')).toBe('Comptes à jour')
  })
  it('du point de vue du débiteur et du créancier', () => {
    const b = { ...base, debtor_id: 1, creditor_id: 2, amount_cents: 1250 }
    expect(plain(balanceLabel(b, members, 1, 'EUR'))).toBe('Vous devez 12,50 € à Alex')
    expect(plain(balanceLabel(b, members, 2, 'EUR'))).toBe('Camille vous doit 12,50 €')
  })
})

describe('groupExpenses', () => {
  it('groupe les dépenses en cours par mois et met les remboursées à part', () => {
    const { months, settled } = groupExpenses([
      expense(1, '2026-09-03'), expense(2, '2026-10-01'), expense(3, '2026-10-05'), expense(4, '2026-08-01', true),
    ])
    expect(months.map((m) => m.month)).toEqual(['2026-10', '2026-09'])
    expect(months[0].items.map((e) => e.id)).toEqual([3, 2])
    expect(settled.map((e) => e.id)).toEqual([4])
  })
})

it('sharePresets garde le sens « à ma charge » selon le payeur', () => {
  expect(sharePresets(true, 'Alex')[1].value).toBe(100)
  expect(sharePresets(false, 'Alex')[1].value).toBe(0)
})

it('formatMoney suit la devise du foyer', () => {
  expect(plain(formatMoney(120000, 'EUR'))).toBe('1 200,00 €')
  expect(plain(formatMoney(999, 'USD'))).toBe('9,99 $US')
})
