// Écran à ouvrir quand on touche une notification push (données envoyées par le backend).
import { notificationArea } from './notifications'

export type PushTarget =
  | { pathname: '/exchange/[id]' | '/expense/[id]' | '/wall/[id]'; params: { id: string } }
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
  // Post du tableau (nouveau, tâche assignée) ou réponse à un post.
  const postId = type === 'wall_reply_added' ? data?.post_id : type.startsWith('wall_') ? data?.id : undefined
  if (postId !== undefined) return { pathname: '/wall/[id]', params: { id: String(postId) } }
  if (type === 'handover_reminder') return { pathname: '/calendar' }
  if (!type) return { pathname: '/notifications' }
  const area = notificationArea(type)
  return { pathname: area === 'calendar' ? '/calendar' : `/${area}` }
}
