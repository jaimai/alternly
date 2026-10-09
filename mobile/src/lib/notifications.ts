// Libellés des notifications in-app : mêmes textes que la cloche web
// (frontend/src/components/NotificationBell.tsx, clés common.notif* de fr.json).
import { formatRange } from './dates'
import type { Notification } from './types'
import { intlLocale, t } from './i18n'

function money(cents: string | undefined): string {
  const n = Number(cents)
  if (!Number.isFinite(n)) return ''
  return (n / 100).toLocaleString(intlLocale(), { style: 'currency', currency: 'EUR' })
}

export function notificationMessage(n: Notification): string {
  const p = n.payload ?? {}
  const range = p.date_start ? formatRange(p.date_start, p.date_end ?? p.date_start) : ''
  const m = (key: string, values?: Record<string, string | undefined>) => t(`notifications.messages.${key}`, values)
  switch (n.type) {
    case 'exchange_proposed':
      return p.note ? m('exchangeProposedNote', { range, note: p.note }) : m('exchangeProposed', { range })
    case 'exchange_accepted':
      return m('exchangeAccepted', { range })
    case 'exchange_refused':
      return m('exchangeRefused', { range })
    case 'exchange_withdrawn':
      return m('exchangeWithdrawn', { range })
    case 'exception_deleted':
      return m('exceptionDeleted', { range })
    case 'rule_changed':
      return m('ruleChanged')
    case 'invite_reminder':
      return m('inviteReminder')
    case 'parent_joined':
      return m('parentJoined', { name: p.display_name })
    case 'parent_left':
      return m('parentLeft', { name: p.display_name })
    case 'expense_added':
      return m('expenseAdded', { label: p.label, amount: money(p.amount_cents) })
    case 'expense_updated':
      return m('expenseUpdated', { label: p.label, amount: money(p.amount_cents) })
    case 'expense_disputed':
      return m('expenseDisputed', { label: p.label })
    case 'expense_resolved':
      return m('expenseResolved', { label: p.label })
    case 'expense_settled':
      return m('expenseSettled', { label: p.label })
    case 'settlement_recorded':
      return m('settlementRecorded', { amount: money(p.amount_cents) })
    case 'change_requested':
      return m('changeRequested', { summary: p.summary })
    case 'change_accepted':
      return m('changeAccepted', { summary: p.summary })
    case 'change_refused':
      return m('changeRefused', { summary: p.summary })
    case 'payment_failed':
      return m('paymentFailed')
    case 'wall_post_added':
      return m('wallPostAdded', { body: p.body })
    case 'wall_reply_added':
      return m('wallReplyAdded', { body: p.body })
    case 'wall_task_assigned':
      return m('wallTaskAssigned', { body: p.body })
    default:
      return m('fallback')
  }
}

export type NotificationArea = 'calendar' | 'expenses' | 'wall' | 'settings'

/** Écran concerné par une notification. */
export function notificationArea(type: string): NotificationArea {
  if (type.startsWith('expense_') || type.startsWith('settlement_')) return 'expenses'
  if (type.startsWith('wall_')) return 'wall'
  // Les demandes de changement (règles, jours spéciaux) se valident dans les Réglages.
  if (type.startsWith('change_')) return 'settings'
  if (type === 'invite_reminder' || type === 'parent_joined' || type === 'parent_left' || type === 'payment_failed') {
    return 'settings'
  }
  return 'calendar'
}
