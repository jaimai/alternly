import { notificationArea, notificationMessage } from '../notifications'
import type { Notification } from '../types'

const n = (type: string, payload: Record<string, unknown>): Notification => ({
  id: 1,
  type,
  payload: payload as Record<string, string>,
  read_at: null,
  created_at: '2026-10-09T10:00:00',
})

describe('notifications', () => {
  it('rédige un échange proposé avec sa note', () => {
    expect(notificationMessage(n('exchange_proposed', { date_start: '2026-10-24', date_end: '2026-10-25', note: 'Anniversaire' })))
      .toBe('Nouvel échange proposé (24 → 25 oct.) — « Anniversaire » — à accepter ou refuser')
  })

  it('formate les montants en euros (centimes numériques du backend)', () => {
    const msg = notificationMessage(n('expense_added', { label: 'Cantine', amount_cents: 8400 }))
    expect(msg).toMatch(/^Nouvelle dépense « Cantine » \(84,00\s€\)$/)
  })

  it('a un libellé de repli pour un type inconnu', () => {
    expect(notificationMessage(n('future_type', {}))).toBe('Nouvelle activité dans votre foyer')
  })

  it('associe chaque type à son écran', () => {
    expect(notificationArea('expense_disputed')).toBe('expenses')
    expect(notificationArea('settlement_recorded')).toBe('expenses')
    expect(notificationArea('wall_task_assigned')).toBe('wall')
    expect(notificationArea('parent_joined')).toBe('settings')
    expect(notificationArea('exchange_accepted')).toBe('calendar')
  })
})
