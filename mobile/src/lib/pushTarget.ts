// Écran à ouvrir quand on touche une notification push (données envoyées par le backend).
import { notificationArea } from './notifications'

export type PushTarget =
  | { pathname: '/exchange/[id]' | '/expense/[id]'; params: { id: string } }
  | { pathname: '/calendar' | '/expenses' | '/wall' | '/settings' | '/notifications' }

export function pushTarget(data: Record<string, unknown> | undefined): PushTarget {
  const type = typeof data?.type === 'string' ? data.type : ''
  if (type === 'exchange_proposed' && data?.id !== undefined) {
    return { pathname: '/exchange/[id]', params: { id: String(data.id) } }
  }
  // Dépense précise (ajoutée, modifiée, contestée…) ; les remboursements restent sur la liste.
  if (type.startsWith('expense_') && type !== 'expense_deleted' && data?.id !== undefined) {
    return { pathname: '/expense/[id]', params: { id: String(data.id) } }
  }
  if (type === 'handover_reminder') return { pathname: '/calendar' }
  if (!type) return { pathname: '/notifications' }
  const area = notificationArea(type)
  return { pathname: area === 'calendar' ? '/calendar' : `/${area}` }
}
