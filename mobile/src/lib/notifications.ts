// Libellés des notifications in-app : mêmes textes que la cloche web
// (frontend/src/components/NotificationBell.tsx, clés common.notif* de fr.json).
import { formatRange } from './dates'
import type { Notification } from './types'
import { intlLocale } from './i18n'

function money(cents: string | undefined): string {
  const n = Number(cents)
  if (!Number.isFinite(n)) return ''
  return (n / 100).toLocaleString(intlLocale(), { style: 'currency', currency: 'EUR' })
}

export function notificationMessage(n: Notification): string {
  const p = n.payload ?? {}
  const range = p.date_start ? formatRange(p.date_start, p.date_end ?? p.date_start) : ''
  switch (n.type) {
    case 'exchange_proposed':
      return p.note
        ? `Nouvel échange proposé (${range}) — « ${p.note} » — à accepter ou refuser`
        : `Nouvel échange proposé (${range}) — à accepter ou refuser`
    case 'exchange_accepted':
      return `Votre proposition d'échange a été acceptée (${range})`
    case 'exchange_refused':
      return `Votre proposition d'échange a été refusée (${range})`
    case 'exchange_withdrawn':
      return `Une proposition d'échange a été retirée (${range})`
    case 'exception_deleted':
      return `Échange de garde annulé (${range})`
    case 'rule_changed':
      return 'Les règles de garde ont été modifiées'
    case 'invite_reminder':
      return "L'autre parent n'a pas encore rejoint le calendrier. Renvoyez-lui l'invitation."
    case 'parent_joined':
      return `${p.display_name} a rejoint le foyer`
    case 'parent_left':
      return `${p.display_name} a supprimé son compte`
    case 'expense_added':
      return `Nouvelle dépense « ${p.label} » (${money(p.amount_cents)})`
    case 'expense_updated':
      return `La dépense « ${p.label} » a été modifiée (${money(p.amount_cents)})`
    case 'expense_disputed':
      return `Votre dépense « ${p.label} » a été contestée`
    case 'expense_resolved':
      return `La contestation sur « ${p.label} » a été levée`
    case 'expense_settled':
      return `« ${p.label} » a été marquée remboursée`
    case 'settlement_recorded':
      return `Remboursement enregistré (${money(p.amount_cents)})`
    case 'change_requested':
      return `Demande de changement à valider : ${p.summary}`
    case 'change_accepted':
      return `Votre demande a été acceptée : ${p.summary}`
    case 'change_refused':
      return `Votre demande a été refusée : ${p.summary}`
    case 'payment_failed':
      return 'Le paiement de votre abonnement a échoué : mettez à jour votre moyen de paiement'
    case 'wall_post_added':
      return `Nouveau sur le tableau : « ${p.body} »`
    case 'wall_reply_added':
      return `Nouvelle réponse : « ${p.body} »`
    case 'wall_task_assigned':
      return `Une tâche vous a été assignée : « ${p.body} »`
    default:
      return 'Nouvelle activité dans votre foyer'
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
