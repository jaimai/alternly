// Monté dans l'espace connecté : réinscrit le téléphone, rafraîchit les données à
// l'arrivée d'un push et ouvre le bon écran quand on le touche (même app fermée).
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { syncPushRegistration } from '@/lib/push'
import { pushTarget } from '@/lib/pushTarget'
import { keys } from '@/lib/queries'

/** Données touchées par une notification : sinon l'écran ouvert affiche l'ancien cache. */
function refresh(qc: QueryClient, data: Record<string, unknown> | undefined) {
  const type = typeof data?.type === 'string' ? data.type : ''
  qc.invalidateQueries({ queryKey: keys.notifications })
  qc.invalidateQueries({ queryKey: ['calendar'] })
  if (type.startsWith('expense_') || type.startsWith('settlement_')) qc.invalidateQueries({ queryKey: keys.expenses })
  if (type.startsWith('wall_')) qc.invalidateQueries({ queryKey: keys.wall })
  if (type.startsWith('change_')) {
    qc.invalidateQueries({ queryKey: keys.changeRequests })
    qc.invalidateQueries({ queryKey: keys.household })
  }
}

export function PushManager() {
  const qc = useQueryClient()
  const lastResponse = Notifications.useLastNotificationResponse()

  useEffect(() => {
    void syncPushRegistration().catch(() => {}) // best effort : l'app marche sans push
    const received = Notifications.addNotificationReceivedListener((n) => {
      refresh(qc, n.request.content.data as Record<string, unknown> | undefined)
    })
    return () => received.remove()
  }, [qc])

  // Notification touchée (y compris celle qui a ouvert l'app).
  useEffect(() => {
    if (!lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const data = lastResponse.notification.request.content.data as Record<string, unknown> | undefined
    refresh(qc, data)
    router.push(pushTarget(data))
  }, [lastResponse, qc])

  return null
}
